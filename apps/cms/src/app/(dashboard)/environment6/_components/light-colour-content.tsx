import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Settings2, Copy } from "lucide-react";
import { Button } from "@platform/ui";
import { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, noProp } from "./utils";

export default function LightColourContent({ state, actions }: any) {
  const [hexInput, setHexInput] = useState(state.color.hex);
  const [mode, setMode] = useState<"RGBW" | "RGB">("RGBW");
  const [isValidHex, setIsValidHex] = useState(true);

  const pickerRef = useRef<HTMLDivElement>(null);
  const baseColorRef = useRef({ r: 1, g: 1, b: 1, w: 0 });

  useEffect(() => {
    setHexInput(state.color.hex);
    setIsValidHex(true);
  }, [state.color.hex]);

  useEffect(() => {
    const max = Math.max(state.color.r, state.color.g, state.color.b, state.color.w);
    if (max > 0) {
      baseColorRef.current = {
        r: state.color.r / max,
        g: state.color.g / max,
        b: state.color.b / max,
        w: state.color.w / max,
      };
    }
  }, [state.color.r, state.color.g, state.color.b, state.color.w]);

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

  const handleRgbChange = (channel: 'r' | 'g' | 'b' | 'w', val: number) => {
    const newColor = { ...state.color, [channel]: val };
    if (channel !== 'w') newColor.hex = rgbToHex(newColor.r, newColor.g, newColor.b);
    actions.setColor(newColor);
  };

  const [isDraggingPicker, setIsDraggingPicker] = useState(false);
  const [internalHsv, setInternalHsv] = useState({ h: 0, v: 0 });
  const lastPickerCallRef = useRef(0);
  const [, startTransition] = React.useTransition();

  // Spectrum drag logic
  const handlePickerDrag = (e: React.PointerEvent<HTMLDivElement>, isFinal = false) => {
    if (!pickerRef.current) return;
    const rect = pickerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const h = (x / rect.width) * 360;
    const s = 1; // Full saturation horizontally in this UI
    const v = 1 - (y / rect.height);

    setInternalHsv({ h, v });

    const now = Date.now();
    if (isFinal || now - lastPickerCallRef.current > 32) {
      lastPickerCallRef.current = now;
      const { r, g, b } = hsvToRgb(h, s, v);
      startTransition(() => actions.setColor({ ...state.color, r, g, b, hex: rgbToHex(r, g, b) }));
    }
  };

  // Derive handle position and brightness
  const baseRgb = {
    r: Math.round(baseColorRef.current.r * 255),
    g: Math.round(baseColorRef.current.g * 255),
    b: Math.round(baseColorRef.current.b * 255),
  };
  const hsv = rgbToHsv(baseRgb.r, baseRgb.g, baseRgb.b);
  
  // If the color is completely black, use the base hue so the handle doesn't snap to 0
  const isBlack = state.color.r === 0 && state.color.g === 0 && state.color.b === 0;
  const currentHsv = rgbToHsv(state.color.r, state.color.g, state.color.b);
  const handleX = (isDraggingPicker ? internalHsv.h : (isBlack ? hsv.h : currentHsv.h)) / 360 * 100;
  const handleY = (1 - (isDraggingPicker ? internalHsv.v : currentHsv.v)) * 100;
  
  const currentBrightness = isDraggingPicker
    ? Math.round((Math.max(internalHsv.v * 255, state.color.w) / 255) * 100)
    : Math.round((Math.max(state.color.r, state.color.g, state.color.b, state.color.w) / 255) * 100);

  return (
    <div className="flex flex-col z-10 relative text-card-foreground" onClick={noProp}>
      <div className="flex items-center gap-2 mb-8">
        <Settings2 className="w-5 h-5" />
        <h3 className="font-semibold tracking-tight text-lg uppercase">Light Colour</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        {/* Left Column (~45%) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="flex bg-zinc-100 dark:bg-zinc-900/50 p-1 rounded-xl w-fit relative">
            <div
              className="absolute top-1 bottom-1 w-20 rounded-lg bg-white dark:bg-zinc-800 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ transform: mode === "RGBW" ? 'translateX(0)' : 'translateX(5rem)' }}
            />
            <button className={`relative z-10 h-8 w-20 text-xs font-bold transition-colors ${mode === "RGBW" ? 'text-foreground' : 'text-muted-foreground'}`} onClick={() => setMode("RGBW")}>RGBW</button>
            <button className={`relative z-10 h-8 w-20 text-xs font-bold transition-colors ${mode === "RGB" ? 'text-foreground' : 'text-muted-foreground'}`} onClick={() => {
              setMode("RGB");
              handleRgbChange('w', 0); // Clear white channel when switching to RGB
            }}>RGB</button>
          </div>

          <div
            ref={pickerRef}
            className="w-full h-48 lg:h-56 rounded-2xl relative cursor-crosshair touch-none shadow-inner overflow-hidden"
            style={{
              background: `linear-gradient(to bottom, transparent, black), linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)`
            }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setIsDraggingPicker(true); handlePickerDrag(e); }}
            onPointerMove={(e) => { if (e.buttons > 0 && isDraggingPicker) handlePickerDrag(e); }}
            onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsDraggingPicker(false); handlePickerDrag(e, true); }}
          >
            <motion.div
              className="absolute w-5 h-5 rounded-full border-[2.5px] border-white shadow-[0_0_8px_rgba(0,0,0,0.6)] -ml-2.5 -mt-2.5 pointer-events-none"
              animate={{ left: `${handleX}%`, top: `${handleY}%` }}
              transition={{ type: "spring", bounce: 0, duration: isDraggingPicker ? 0 : 0.2 }}
            />
          </div>

        </div>

        {/* Center Column (~25%) */}
        <div className="lg:col-span-3 flex flex-col gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block">Preview</span>
          <motion.div
            className="w-full aspect-square md:aspect-[4/3] lg:aspect-[4/5] rounded-[24px] shadow-inner"
            animate={{ backgroundColor: state.color.hex, opacity: Math.max(0.2, currentBrightness / 100) }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
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
                className="h-14 px-8 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                onClick={handleHexApply}
                disabled={!isValidHex}
              >
                Apply
              </Button>
            </div>
          </div>

          <div className="pt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-3">RGBW Values</span>
            <div className="flex items-center gap-1.5">
              {['r', 'g', 'b', 'w'].map(c => {
                if (mode === "RGB" && c === 'w') return null;
                return (
                  <div key={c} className="flex-1 flex flex-col items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase text-muted-foreground">{c}</span>
                    <input
                      type="number" min="0" max="255" step="any"
                      value={state.color[c as 'r' | 'g' | 'b' | 'w']}
                      onChange={(e) => handleRgbChange(c as 'r' | 'g' | 'b' | 'w', parseFloat(e.target.value) || 0)}
                      className="w-full px-0.5 bg-muted/50 border border-transparent focus:border-primary focus:bg-background rounded-xl h-12 text-center text-xs font-black focus:outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                );
              })}
              <div className="flex items-end pb-2 pl-1 shrink-0"><span className="text-muted-foreground font-black text-xs">%</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
