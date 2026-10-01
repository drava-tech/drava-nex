import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { motion, useMotionValue } from "framer-motion";
import { Settings2, Copy } from "lucide-react";
import { Button } from "@platform/ui";
import { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, noProp } from "./utils";

export default function LightColourContent({ state, actions }: any) {
  const [hexInput, setHexInput] = useState(state.color.hex);
  const [isValidHex, setIsValidHex] = useState(true);

  const pickerRef = useRef<HTMLDivElement>(null);
  // The spectrum is hue+value only (saturation is locked to 1 in
  // handlePickerDrag below), so it can never represent white/gray/black —
  // those all compute hue 0, which is pure red. Remember the last hue that
  // actually had color so the handle falls back to *that* instead of
  // snapping to the red end whenever the current color is achromatic.
  const lastHueRef = useRef(0);

  useEffect(() => {
    setHexInput(state.color.hex);
    setIsValidHex(true);
  }, [state.color.hex]);

  useEffect(() => {
    const { h, s } = rgbToHsv(state.color.r, state.color.g, state.color.b);
    if (s > 0) lastHueRef.current = h;
  }, [state.color.r, state.color.g, state.color.b]);

  const handleHexChange = (val: string) => {
    setHexInput(val);
    setIsValidHex(/^#[0-9A-F]{6}$/i.test(val));
  };

  const handleHexApply = () => {
    if (isValidHex) {
      const { r, g, b } = hexToRgb(hexInput);
      actions.setColor({ ...state.color, r, g, b, hex: hexInput.toUpperCase() });
      if (actions.closeColourPanel) actions.closeColourPanel();
    }
  };

  const handleRgbChange = (channel: 'r' | 'g' | 'b', val: number) => {
    const newColor = { ...state.color, [channel]: val };
    newColor.hex = rgbToHex(newColor.r, newColor.g, newColor.b);
    actions.setColor(newColor);
  };

  const isDraggingRef = useRef(false);
  const lastPickerCallRef = useRef(0);
  const [, startTransition] = React.useTransition();

  /**
   * Handle position and live preview are MotionValues, not React state.
   *
   * This used to be a setInternalHsv on every pointermove — unthrottled, so a
   * fast mouse re-rendered this whole panel 100+ times a second — feeding a
   * framer animate={{ left, top }}. left/top are layout properties, so every
   * one of those frames also forced a reflow. (The 32ms gate below only ever
   * throttled the network call, never the render.)
   *
   * Written straight to the compositor instead: dragging now costs zero React
   * renders and moves only transform/opacity. Same ref-mutation pattern as
   * SwipeCard in broadcast/_components/publish-board.tsx.
   *
   * Pixels rather than percentages, because a translate percentage resolves
   * against the handle's own box, not the spectrum's — syncPickerFromColor
   * converts, and re-runs on resize.
   */
  const handleXMv = useMotionValue(0);
  const handleYMv = useMotionValue(0);
  const previewOpacity = useMotionValue(1);
  const previewColor = useMotionValue(state.color.hex as string);

  /** Push an h (0..360) / v (0..1) pair into the motion values. */
  const paintPicker = useCallback(
    (h: number, v: number, hex: string) => {
      const rect = pickerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        handleXMv.set((h / 360) * rect.width);
        handleYMv.set((1 - v) * rect.height);
      }
      previewOpacity.set(Math.max(0.2, v));
      previewColor.set(hex);
    },
    [handleXMv, handleYMv, previewOpacity, previewColor]
  );

  /** Re-derive the handle from the authoritative colour — for external changes
   *  (another client, a preset, the hex box) and for resizes. */
  const syncPickerFromColor = useCallback(() => {
    if (isDraggingRef.current) return;
    const { h, s, v } = rgbToHsv(state.color.r, state.color.g, state.color.b);
    // White/gray/black have no real hue (saturation 0) — fall back to the last
    // hue that did, rather than letting the handle snap to red (hue 0).
    paintPicker(s === 0 ? lastHueRef.current : h, v, state.color.hex);
  }, [state.color, paintPicker]);

  useLayoutEffect(() => {
    syncPickerFromColor();
  }, [syncPickerFromColor]);

  // The spectrum is responsive, so a layout change moves the handle's correct
  // pixel position even when the colour itself has not changed.
  useEffect(() => {
    const el = pickerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncPickerFromColor());
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncPickerFromColor]);

  // Spectrum drag logic
  const handlePickerDrag = (e: React.PointerEvent<HTMLDivElement>, isFinal = false) => {
    if (!pickerRef.current) return;
    const rect = pickerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const h = (x / rect.width) * 360;
    const s = 1; // Full saturation horizontally in this UI
    const v = 1 - (y / rect.height);
    const { r, g, b } = hsvToRgb(h, s, v);
    const hex = rgbToHex(r, g, b);

    // Every pointer event moves the handle — through the compositor, not React.
    paintPicker(h, v, hex);

    const now = Date.now();
    if (isFinal || now - lastPickerCallRef.current > 32) {
      lastPickerCallRef.current = now;
      startTransition(() => actions.setColor({ ...state.color, r, g, b, hex }));
    }
  };

  return (
    <div className="flex flex-col z-10 relative text-card-foreground" onClick={noProp}>
      <div className="flex items-center gap-2 mb-8">
        <Settings2 className="w-5 h-5" />
        <h3 className="font-semibold tracking-tight text-lg uppercase">Light Colour</h3>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-1 rounded-full">
          {state.targetLabel ?? "Light"}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        {/* Left Column (~45%) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div
            ref={pickerRef}
            className="w-full h-48 lg:h-56 rounded-2xl relative cursor-crosshair touch-none shadow-inner overflow-hidden"
            style={{
              background: `linear-gradient(to bottom, transparent, black), linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)`
            }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); isDraggingRef.current = true; handlePickerDrag(e); }}
            onPointerMove={(e) => { if (e.buttons > 0 && isDraggingRef.current) handlePickerDrag(e); }}
            onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); isDraggingRef.current = false; handlePickerDrag(e, true); }}
          >
            {/* left/top pinned at 0; the handle is placed purely by transform,
                so moving it never invalidates layout. */}
            <motion.div
              className="absolute top-0 left-0 w-5 h-5 rounded-full border-[2.5px] border-white shadow-[0_0_8px_rgba(0,0,0,0.6)] -ml-2.5 -mt-2.5 pointer-events-none"
              style={{ x: handleXMv, y: handleYMv }}
            />
          </div>

        </div>

        {/* Center Column (~25%) */}
        <div className="lg:col-span-3 flex flex-col gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block">Preview</span>
          <motion.div
            className="w-full aspect-square md:aspect-[4/3] lg:aspect-[4/5] rounded-[24px] shadow-inner"
            style={{ backgroundColor: previewColor, opacity: previewOpacity }}
          />
        </div>

        {/* Right Column (~30%) */}
        <div className="lg:col-span-4 flex flex-col gap-8">

          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">Hex Code</span>
            <div className="flex items-center justify-between border border-border rounded-2xl px-5 py-4 bg-muted/30">
              <span className="font-mono font-black">{state.color.hex}</span>
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg hover:bg-muted"><Copy className="w-4 h-4 text-muted-foreground" /></Button>
            </div>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">Edit Hex Code</span>
            <div className="flex gap-3 items-start">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={hexInput}
                  onChange={(e) => handleHexChange(e.target.value)}
                  className={`w-full bg-transparent border ${isValidHex ? 'border-border focus:border-primary' : 'border-red-500 focus:border-red-500'} rounded-2xl px-5 text-sm font-mono focus:outline-none h-14 shadow-sm transition-colors`}
                />
                {!isValidHex && <span className="absolute -bottom-5 left-2 text-[10px] text-red-500 font-medium">Invalid HEX format</span>}
              </div>
              <Button
                size="sm"
                className="h-14 px-8"
                onClick={handleHexApply}
                disabled={!isValidHex}
              >
                Apply
              </Button>
            </div>
          </div>

          <div className="pt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">RGB Values</span>
            <div className="flex items-center gap-1.5">
              {(['r', 'g', 'b'] as const).map(c => (
                <div key={c} className="flex-1 flex flex-col items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase text-muted-foreground">{c}</span>
                  <input
                    type="number" min="0" max="255" step="any"
                    value={state.color[c]}
                    onChange={(e) => handleRgbChange(c, parseFloat(e.target.value) || 0)}
                    className="w-full px-0.5 bg-muted/50 border border-transparent focus:border-primary focus:bg-background rounded-xl h-12 text-center text-xs font-black focus:outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
