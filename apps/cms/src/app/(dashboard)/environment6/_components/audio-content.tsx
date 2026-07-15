import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Speaker as SpeakerIcon, Plug, VolumeX, Mic } from "lucide-react";
import { Badge } from "@platform/ui";
import { MiniSlider, Switch } from "./controls";
import { noProp } from "./utils";

export default function AudioContent({ isExpanded, state, actions }: any) {
  const inputOptions = ["HDMI", "AUX", "Bluetooth"] as const;
  const currentInput = state.input ?? inputOptions[0];
  const [showInputOptions, setShowInputOptions] = useState(false);
  const [analyzerStatus, setAnalyzerStatus] = useState<"idle" | "listening" | "blocked">("idle");
  const [liveWaveform, setLiveWaveform] = useState(() => Array.from({ length: 48 }, () => 10));
  const [isDragging, setIsDragging] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const stopDeviceAnalyzer = () => {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    analyzerRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    setAnalyzerStatus("idle");
  };

  const startDeviceAnalyzer = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setAnalyzerStatus("blocked");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const audioContext = new AudioContext();
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 128;
      analyzer.smoothingTimeConstant = 0.72;
      audioContext.createMediaStreamSource(stream).connect(analyzer);

      audioStreamRef.current = stream;
      audioContextRef.current = audioContext;
      analyzerRef.current = analyzer;
      setAnalyzerStatus("listening");
    } catch {
      setAnalyzerStatus("blocked");
    }
  };

  useEffect(() => {
    return () => {
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioContextRef.current) void audioContextRef.current.close();
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    const start = performance.now();
    const frequencyData = new Uint8Array(64);

    const tick = (now: number) => {
      const analyzer = analyzerRef.current;

      if (analyzer && analyzerStatus === "listening" && state.power && !state.muted) {
        analyzer.getByteFrequencyData(frequencyData);
        const volumeScale = Math.max(0.15, state.volume / 100);
        setLiveWaveform(Array.from({ length: 48 }, (_, i) => {
          const bin = Math.min(frequencyData.length - 1, Math.floor((i / 48) * frequencyData.length));
          const nextBin = Math.min(frequencyData.length - 1, bin + 1);
          const raw = ((frequencyData[bin] ?? 0) * 0.72 + (frequencyData[nextBin] ?? 0) * 0.28) / 255;
          const bassBoost = i < 12 ? 1 + state.bass / 20 : 1;
          return Math.max(8, Math.min(100, raw * 120 * volumeScale * bassBoost));
        }));
      } else {
        const elapsed = (now - start) / 1000;
        const level = state.power && state.playing && !state.muted ? Math.max(0.12, state.volume / 100) : 0;

        setLiveWaveform(Array.from({ length: 48 }, (_, i) => {
          if (!level) return 8;
          const bassBoost = 1 + state.bass / 24;
          const low = Math.sin(elapsed * 4.8 + i * 0.34) * 18 * bassBoost;
          const mid = Math.sin(elapsed * 8.5 + i * 0.72) * 10;
          const high = Math.sin(elapsed * 14 + i * 1.1) * 5;
          const envelope = Math.sin(i / 47 * Math.PI) * 18;
          return Math.max(8, Math.min(100, (28 + envelope + low + mid + high) * level));
        }));
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [analyzerStatus, state.bass, state.muted, state.playing, state.power, state.volume]);

  const updateVol = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    actions.setVolume(Math.round((Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width) * 100));
    actions.setMuted(false);
  };

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0`}>
            <SpeakerIcon className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight`}>Audio</h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          <Badge variant={state.power ? "default" : "secondary"} className={`${isExpanded ? "" : "hidden xl:inline-flex"} bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 shadow-none font-bold uppercase text-[10px] tracking-widest`}>{state.power ? "Playing" : "Off"}</Badge>
          <Switch checked={state.power} onChange={actions.setPower} />
        </div>
      </div>

      <div className={`flex-1 flex flex-col justify-center transition-all duration-150 ${!state.power ? 'opacity-40 grayscale-[0.8] pointer-events-none' : ''}`}>
        {!isExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 leading-none">
              <span className="text-3xl font-black md:text-[2rem]">{state.muted ? "Mute" : `${state.volume}%`}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Volume</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${state.power && !state.muted ? state.volume : 0}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 w-full flex-col gap-4 lg:gap-6 py-1" onClick={noProp}>
            <div className="grid grid-cols-1 xl:grid-cols-[112px_112px_112px_minmax(0,1fr)] gap-2 lg:gap-3 items-stretch shrink-0">
              <div className="relative z-30">
                <button
                  onClick={(e) => { noProp(e); setShowInputOptions((open) => !open); }}
                  className="h-12 lg:h-16 w-full rounded-xl border border-blue-500/30 bg-blue-500/10 px-2 py-2 flex flex-col items-center justify-center gap-1 text-blue-500 font-bold transition-all hover:bg-blue-500/15 shadow-[0_0_14px_rgba(59,130,246,0.18)]"
                >
                  <Plug className="w-4 h-4 lg:w-5 lg:h-5" />
                  <span className="text-[8px] lg:text-[10px] uppercase tracking-widest">Input {currentInput}</span>
                </button>
                <AnimatePresence>
                  {showInputOptions && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                      className="absolute left-0 top-full z-50 mt-2 w-40 rounded-xl border border-blue-500/25 bg-card/95 p-1.5 shadow-2xl backdrop-blur"
                    >
                      <div className="grid gap-1">
                        {inputOptions.map((input) => (
                          <button
                            key={input}
                            onClick={(e) => { noProp(e); actions.setInput(input); setShowInputOptions(false); }}
                            className={`h-8 rounded-lg border px-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                              currentInput === input
                                ? 'bg-blue-500/15 text-blue-500 border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.22)]'
                               : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/60'
                            }`}
                          >
                            {input}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button
                onClick={(e) => { noProp(e); actions.setMuted(!state.muted); }}
                className={`h-12 lg:h-16 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all ${
                  state.muted
                    ? 'bg-red-500/10 text-red-500 border-red-500/40 shadow-[0_0_14px_rgba(239,68,68,0.25)]'
                    : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                }`}
              >
                <VolumeX className="w-4 h-4 lg:w-5 lg:h-5" />
                <span className="text-[8px] lg:text-[10px] uppercase tracking-widest">{state.muted ? "Muted" : "Mute"}</span>
              </button>

              <button
                onClick={(e) => { noProp(e); analyzerStatus === "listening" ? stopDeviceAnalyzer() : void startDeviceAnalyzer(); }}
                className={`h-12 lg:h-16 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-1 font-bold transition-all ${analyzerStatus === "listening" ? 'bg-blue-500/10 text-blue-500 border-blue-500/40 shadow-[0_0_14px_rgba(59,130,246,0.25)]' : analyzerStatus === "blocked" ? 'bg-red-500/10 text-red-500 border-red-500/40' : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'}`}
              >
                <Mic className="w-4 h-4 lg:w-5 lg:h-5" />
                <span className="text-[8px] lg:text-[10px] uppercase tracking-widest">{analyzerStatus === "listening" ? "Live" : analyzerStatus === "blocked" ? "Blocked" : "Device"}</span>
              </button>

              <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 lg:px-4 lg:py-3">
                <MiniSlider
                  label="Bass Control"
                  value={state.bass}
                  onChange={actions.setBass}
                  min={-10}
                  max={10}
                  suffix=""
                  color="bg-blue-500"
                />
              </div>
            </div>

            <div className="min-w-0 lg:flex lg:flex-1 lg:min-h-0 lg:flex-col">
              <div className="flex items-start justify-between mb-2 lg:mb-4 shrink-0">
                <span className="text-3xl lg:text-5xl font-black">{state.muted ? 0 : state.volume}<span className="text-lg lg:text-2xl text-blue-500/50">%</span></span>
                <span className="text-[10px] lg:text-xs font-bold text-muted-foreground uppercase tracking-widest">Master Volume</span>
              </div>
              <div
                className="w-full h-20 relative cursor-ew-resize touch-none flex items-end justify-between gap-[2px] lg:h-auto lg:flex-1 lg:min-h-0 lg:max-h-40"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setIsDragging(true); updateVol(e); }}
                onPointerMove={(e) => { if (isDragging) updateVol(e); }}
                onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsDragging(false); }}
                onPointerCancel={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsDragging(false); }}
              >
                {liveWaveform.map((h, i) => {
                  const vol = state.muted ? 0 : state.volume;
                  const isActive = state.power && !state.muted && (i / liveWaveform.length) * 100 <= vol;
                  return (
                    <div key={i} className={`flex-1 rounded-full transition-all duration-150 ${isActive ? 'bg-gradient-to-t from-blue-600 to-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]' : 'bg-muted'}`}
                      style={{ height: `${h}%`, opacity: isActive ? 1 : 0.5 }} />
                  );
                })}
              </div>
              <p className="text-center text-[9px] lg:text-[10px] font-bold text-blue-500 tracking-widest uppercase opacity-60 mt-2 lg:mt-3 shrink-0">Slide to adjust</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
