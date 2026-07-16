"use client";

import React, { useState, useMemo } from "react";
import {
  Volume2,
  Snowflake,
  Wind,
  Flame,
  Power,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";

const getTempColor = (temp: number) => {
  if (temp < 20) return "from-cyan-400 to-blue-600";
  if (temp < 24) return "from-emerald-400 to-teal-600";
  if (temp < 27) return "from-orange-400 to-amber-600";
  return "from-rose-500 to-red-600";
};

// ── Types ─────────────────────────────────────────────────────────────────────
type StripId = "front" | "left";
type Strip = { power: boolean; brightness: number; color: string };
type AudioState = { power: boolean; volume: number; muted: boolean };
type AcMode = "Cool" | "Heat" | "Auto";
type AcState = { power: boolean; temp: number; mode: AcMode };

const SWATCHES: { name: string; hex: string }[] = [
  { name: "Warm", hex: "#ff9d4d" },
  { name: "Soft", hex: "#ffe6c2" },
  { name: "Daylight", hex: "#dbe7ff" },
  { name: "Red", hex: "#ff4d4d" },
  { name: "Green", hex: "#48e08a" },
  { name: "Blue", hex: "#4d8bff" },
  { name: "Purple", hex: "#9d6bff" },
  { name: "Cyan", hex: "#3fd9d9" },
];

const AUDIO_RING = "#38bdf8";

// ── Isometric projection ────────────────────────────────────────────────────────
const TW = 22; // tile half-width
const TH = 11; // tile half-height (2:1)
const ZS = 14; // height scale per unit
const OX = 355; // screen origin x
const OY = 120; // screen origin y
const U = 10; // room depth (front→back)
const V = 14; // room width (left→right)
const H = 6; // wall height

function iso(u: number, v: number, z = 0): [number, number] {
  return [OX + (u - v) * TW, OY + (u + v) * TH - z * ZS];
}
function poly(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

// Extruded cuboid with 3 shaded faces (top / +u / +v)
function Box3D({
  u, v, du, dv, h, z = 0, color, edge,
}: {
  u: number; v: number; du: number; dv: number; h: number; z?: number; color: string; edge?: string;
}) {
  const top = poly([iso(u, v, z + h), iso(u + du, v, z + h), iso(u + du, v + dv, z + h), iso(u, v + dv, z + h)]);
  const right = poly([iso(u + du, v, z + h), iso(u + du, v + dv, z + h), iso(u + du, v + dv, z), iso(u + du, v, z)]);
  const left = poly([iso(u, v + dv, z + h), iso(u + du, v + dv, z + h), iso(u + du, v + dv, z), iso(u, v + dv, z)]);
  return (
    <g>
      <polygon points={left} fill={shade(color, 0.5)} />
      <polygon points={right} fill={shade(color, 0.72)} />
      <polygon points={top} fill={shade(color, 1)} stroke={edge ?? shade(color, 1.2)} strokeWidth="0.6" />
    </g>
  );
}

function Chair({ cu, cv, facing }: { cu: number; cv: number; facing: "u-" | "u+" | "v-" | "v+" }) {
  const s = 0.95;
  const su = cu - s / 2;
  const sv = cv - s / 2;
  const seat = <Box3D u={su} v={sv} du={s} dv={s} h={0.55} color="#3a3f4d" />;
  const t = 0.18; // backrest thickness
  let back: React.ReactNode;
  let backFirst = false;
  if (facing === "v-") { back = <Box3D u={su} v={sv - t} du={s} dv={t} h={1.5} color="#454b5b" />; backFirst = true; }
  else if (facing === "v+") { back = <Box3D u={su} v={sv + s} du={s} dv={t} h={1.5} color="#454b5b" />; }
  else if (facing === "u-") { back = <Box3D u={su - t} v={sv} du={t} dv={s} h={1.5} color="#454b5b" />; backFirst = true; }
  else { back = <Box3D u={su + s} v={sv} du={t} dv={s} h={1.5} color="#454b5b" />; }
  return <g>{backFirst ? <>{back}{seat}</> : <>{seat}{back}</>}</g>;
}

// ── Room twin (isometric) ───────────────────────────────────────────────────────
function RoomTwin({
  strips, audio, ac, selectedStrip, onSelectStrip,
}: {
  strips: Record<StripId, Strip>;
  audio: AudioState;
  ac: AcState;
  selectedStrip: StripId;
  onSelectStrip: (id: StripId) => void;
}) {
  const fb = strips.front.power ? strips.front.brightness / 100 : 0;
  const lb = strips.left.power ? strips.left.brightness / 100 : 0;
  const audioOn = audio.power && !audio.muted && audio.volume > 0;
  const acTint = ac.mode === "Cool" ? "#38bdf8" : ac.mode === "Heat" ? "#fb923c" : "#a78bfa";

  const floor = poly([iso(0, 0), iso(U, 0), iso(U, V), iso(0, V)]);
  const wallF = poly([iso(0, 0, 0), iso(U, 0, 0), iso(U, 0, H), iso(0, 0, H)]);
  const wallL = poly([iso(0, 0, 0), iso(0, V, 0), iso(0, V, H), iso(0, 0, H)]);

  const fLine = { a: iso(0, 0, H), b: iso(U, 0, H) };
  const lLine = { a: iso(0, 0, H), b: iso(0, V, H) };

  const door = poly([iso(0, 1, 0), iso(0, 3, 0), iso(0, 3, 4), iso(0, 1, 4)]);
  const display = poly([iso(3, 0, 2), iso(7, 0, 2), iso(7, 0, 5), iso(3, 0, 5)]);
  const soundbar = poly([iso(3.4, 0, 1.4), iso(6.6, 0, 1.4), iso(6.6, 0, 1.8), iso(3.4, 0, 1.8)]);

  const spk = (cu: number) => {
    const [tx, ty] = iso(cu + 0.4, 0.8, 1.8);
    return { tx, ty };
  };

  return (
    <svg viewBox="0 0 620 420" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
      <defs>
        <linearGradient id="frontGlow" gradientUnits="userSpaceOnUse" x1="0" y1={fLine.a[1]} x2="0" y2={iso(U, 0, 0)[1]}>
          <stop offset="0%" stopColor={strips.front.color} stopOpacity={0.1 + fb * 0.55} />
          <stop offset="100%" stopColor={strips.front.color} stopOpacity={0} />
        </linearGradient>
        <linearGradient id="leftGlow" gradientUnits="userSpaceOnUse" x1="0" y1={lLine.a[1]} x2="0" y2={iso(0, V, 0)[1]}>
          <stop offset="0%" stopColor={strips.left.color} stopOpacity={0.1 + lb * 0.55} />
          <stop offset="100%" stopColor={strips.left.color} stopOpacity={0} />
        </linearGradient>
        <radialGradient id="floorVig" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor="#1c1f29" />
          <stop offset="100%" stopColor="#0e1016" />
        </radialGradient>
        <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* Walls */}
      <polygon points={wallL} fill="#0d0f15" stroke="#232734" strokeWidth="1" />
      <polygon points={wallF} fill="#0a0c11" stroke="#232734" strokeWidth="1" />
      {/* Wall glows */}
      <polygon points={wallF} fill="url(#frontGlow)" />
      <polygon points={wallL} fill="url(#leftGlow)" />

      {/* Floor */}
      <polygon points={floor} fill="url(#floorVig)" stroke="#262a36" strokeWidth="1" />

      {/* Door on left wall (back-left) */}
      <polygon points={door} fill="#05060a" stroke="#2c3242" strokeWidth="1" />
      <text {...textAt(iso(0, 2, 4.6))} fill="#5b6072" fontSize="9" fontWeight="700" textAnchor="middle">DOOR</text>

      {/* AC on left wall */}
      <Box3D u={0} v={10} du={0.5} dv={2.2} h={1.7} z={3.6} color="#2a2f3a" />
      {[0, 1, 2, 3].map((i) => {
        const a = iso(0.5, 10.2 + i * 0.5, 4.4);
        const b = iso(0.5, 10.2 + i * 0.5, 5.0);
        return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={ac.power ? acTint : "#3a3d4d"} strokeWidth="1.5" strokeOpacity={ac.power ? 0.8 : 0.4} />;
      })}
      <text {...textAt(iso(0, 11, 3.2))} fill="#5b6072" fontSize="9" fontWeight="700" textAnchor="middle">AC</text>

      {/* Display + soundbar on front wall */}
      <polygon points={display} fill="#05070c" stroke="#2c3242" strokeWidth="1.2" />
      <polygon points={display} fill="#1b3a5a" opacity="0.25" />
      <polygon points={soundbar} fill="#1a1d24" stroke="#34394a" strokeWidth="0.8" />
      <text {...textAt(iso(5, 0, 5.5))} fill="#6b7080" fontSize="9" fontWeight="700" textAnchor="middle">DISPLAY 86″</text>

      {/* Kiosk (front-right corner) */}
      <Box3D u={8.3} v={0.6} du={1} dv={0.9} h={3} color="#262a34" />
      <text {...textAt(iso(8.8, 1, 3.3))} fill="#5b6072" fontSize="8.5" fontWeight="700" textAnchor="middle">KIOSK</text>

      {/* Speakers flanking display */}
      {[2, 7].map((cu, i) => (
        <g key={i}>
          <Box3D u={cu} v={0.6} du={0.8} dv={0.9} h={1.8} color="#20242e" />
          {audioOn && [0, 0.6].map((d, k) => {
            const c = spk(cu);
            return (
              <circle key={k} cx={c.tx} cy={c.ty} r="6" fill="none" stroke={AUDIO_RING} strokeWidth="1.5">
                <animate attributeName="r" values="6;20" dur="1.8s" begin={`${d}s`} repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.55;0" dur="1.8s" begin={`${d}s`} repeatCount="indefinite" />
              </circle>
            );
          })}
        </g>
      ))}

      {/* Chairs (back of table) + table + chairs (front of table) — painter order */}
      <Chair cu={4} cv={4.6} facing="v-" />
      <Chair cu={2.2} cv={7} facing="u-" />
      <Chair cu={6} cv={4.6} facing="v-" />

      {/* Table (portrait, long axis = depth) */}
      <Box3D u={3} v={5.5} du={4} dv={3} h={1.05} color="#2b2f3a" />
      <text {...textAt(iso(5, 7, 1.1))} fill="#565b6b" fontSize="9" fontWeight="700" textAnchor="middle">TABLE</text>

      <Chair cu={4} cv={9.4} facing="v+" />
      <Chair cu={7.8} cv={7} facing="u+" />
      <Chair cu={6} cv={9.4} facing="v+" />

      {/* Strip light tubes (clickable, glowing) */}
      <g onClick={() => onSelectStrip("front")} style={{ cursor: "pointer" }}>
        <line x1={fLine.a[0]} y1={fLine.a[1]} x2={fLine.b[0]} y2={fLine.b[1]}
          stroke={strips.front.color} strokeOpacity={strips.front.power ? 0.4 + fb * 0.6 : 0.12}
          strokeWidth={selectedStrip === "front" ? 9 : 6} strokeLinecap="round" filter="url(#bloom)" />
        <line x1={fLine.a[0]} y1={fLine.a[1]} x2={fLine.b[0]} y2={fLine.b[1]}
          stroke={strips.front.power ? strips.front.color : "#3a3d4d"} strokeOpacity={strips.front.power ? 0.95 : 0.3}
          strokeWidth="2.5" strokeLinecap="round" />
        {selectedStrip === "front" && (
          <line x1={fLine.a[0]} y1={fLine.a[1]} x2={fLine.b[0]} y2={fLine.b[1]} stroke="#fff" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 4" />
        )}
      </g>
      <g onClick={() => onSelectStrip("left")} style={{ cursor: "pointer" }}>
        <line x1={lLine.a[0]} y1={lLine.a[1]} x2={lLine.b[0]} y2={lLine.b[1]}
          stroke={strips.left.color} strokeOpacity={strips.left.power ? 0.4 + lb * 0.6 : 0.12}
          strokeWidth={selectedStrip === "left" ? 9 : 6} strokeLinecap="round" filter="url(#bloom)" />
        <line x1={lLine.a[0]} y1={lLine.a[1]} x2={lLine.b[0]} y2={lLine.b[1]}
          stroke={strips.left.power ? strips.left.color : "#3a3d4d"} strokeOpacity={strips.left.power ? 0.95 : 0.3}
          strokeWidth="2.5" strokeLinecap="round" />
        {selectedStrip === "left" && (
          <line x1={lLine.a[0]} y1={lLine.a[1]} x2={lLine.b[0]} y2={lLine.b[1]} stroke="#fff" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 4" />
        )}
      </g>
    </svg>
  );
}

function textAt([x, y]: [number, number]) {
  return { x, y };
}

// ── Small UI primitives ────────────────────────────────────────────────────────
// ── Main component ─────────────────────────────────────────────────────────────
export function EnvironmentView() {
  const [strips, setStrips] = useState<Record<StripId, Strip>>({
    front: { power: true, brightness: 80, color: "#ff9d4d" },
    left: { power: true, brightness: 70, color: "#ff9d4d" },
  });
  const [selectedStrip, setSelectedStrip] = useState<StripId>("front");
  const [audio, setAudio] = useState<AudioState>({ power: true, volume: 60, muted: false });
  const [ac, setAc] = useState<AcState>({ power: true, temp: 22, mode: "Cool" });
  const [showPalette, setShowPalette] = useState(false);

  const waveform = useMemo(() => Array.from({ length: 48 }, (_, i) =>
    Number(Math.max(10, Math.abs(Math.sin(i * 0.3) * 20 + Math.cos(i * 0.7) * 15 + 20)).toFixed(1))
  ), []);
  const [isVolDragging, setIsVolDragging] = useState(false);
  const updateVol = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const v = Math.round((Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width) * 100);
    setAudio(s => ({ ...s, volume: v, muted: false }));
  };

  const updateStrip = (id: StripId, patch: Partial<Strip>) =>
    setStrips((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  const sel = strips[selectedStrip];
  const lightsOn = strips.front.power || strips.left.power;
  const activeCount = [lightsOn, audio.power, ac.power].filter(Boolean).length;
  const setAllLights = (power: boolean) =>
    setStrips((s) => ({ front: { ...s.front, power }, left: { ...s.left, power } }));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2 shrink-0">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground">Digital Twin · 3D View</p>
          <h1 className="text-lg font-black tracking-tight">Experience Centre</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {activeCount}/3 Active
        </span>
      </div>

      {/* Room twin */}
      <div className="relative mx-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#1a1d3d] bg-[#070912]">
        <RoomTwin strips={strips} audio={audio} ac={ac} selectedStrip={selectedStrip} onSelectStrip={setSelectedStrip} />
      </div>

      {/* Controls */}
      <div className="grid shrink-0 grid-cols-3 gap-3 px-4 py-2.5">
        
        {/* Audio Control */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-semibold text-foreground">Audio Control</span>
            </div>
            <button onClick={() => setAudio(s => ({ ...s, power: !s.power }))} className={`transition-colors ${audio.power ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "text-muted-foreground hover:text-emerald-400/50"}`}>
              <Power className="h-4 w-4" />
            </button>
          </div>
          
          <div className={`flex flex-col flex-1 min-h-0 transition-opacity ${!audio.power ? "pointer-events-none opacity-40" : ""}`}>
            <div className="flex-1 flex flex-col justify-end gap-2 min-h-0 pt-1">
              <div className="flex justify-between items-baseline">
                <span className="text-xl font-black">{audio.muted ? 0 : audio.volume}<span className="text-sm text-blue-500/50">%</span></span>
                <span className="text-[9px] text-muted-foreground uppercase tracking-widest">Master Vol</span>
              </div>
              <div
                className="w-full h-16 relative cursor-ew-resize touch-none flex items-end justify-between gap-[1px]"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setIsVolDragging(true); updateVol(e); }}
                onPointerMove={(e) => { if (isVolDragging) updateVol(e); }}
                onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsVolDragging(false); }}
                onPointerCancel={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setIsVolDragging(false); }}
              >
                {waveform.map((h, i) => {
                  const vol = audio.muted ? 0 : audio.volume;
                  const isActive = (i / waveform.length) * 100 <= vol;
                  return (
                    <div key={i} className={`flex-1 rounded-full transition duration-150 ${isActive ? 'bg-gradient-to-t from-blue-600 to-cyan-400 shadow-[0_0_6px_rgba(56,189,248,0.4)]' : 'bg-muted'}`}
                      style={{ height: `${h}%`, opacity: isActive ? 1 : 0.5 }} />
                  );
                })}
              </div>
              <p className="text-center text-[9px] font-bold text-blue-500/60 tracking-widest uppercase">Slide to adjust</p>
            </div>
          </div>
        </div>

        {/* Climate Control */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Snowflake className="h-4 w-4 text-blue-400" />
              <span className="text-xs font-semibold text-foreground">Climate Control</span>
            </div>
            <button onClick={() => setAc(s => ({ ...s, power: !s.power }))} className={`transition-colors ${ac.power ? "text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]" : "text-muted-foreground hover:text-blue-400/50"}`}>
              <Power className="h-4 w-4" />
            </button>
          </div>

          <div className={`flex flex-col flex-1 min-h-0 transition-opacity ${!ac.power ? "pointer-events-none opacity-40" : ""}`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0">
              <div className="relative w-28 h-28 flex items-center justify-center">
                {Array.from({ length: 48 }).map((_, i) => {
                  const tickTemp = 15 + (i / 3);
                  const isActive = tickTemp <= ac.temp;
                  return (
                    <div key={i} className="absolute inset-0 pointer-events-none" style={{ transform: `rotate(${i * 7.5}deg)` }}>
                      <div className={`w-[1.5px] h-2 mx-auto rounded-full transition-colors duration-500 ${isActive
                        ? (ac.temp > 24 ? 'bg-orange-500 shadow-[0_0_6px_#f97316]' : 'bg-cyan-500 shadow-[0_0_6px_#06b6d4]')
                        : 'bg-muted-foreground/20'
                      }`} />
                    </div>
                  );
                })}
                <div className="relative w-20 h-20 rounded-full bg-card border border-border shadow-xl flex flex-col items-center justify-center z-10">
                  <div className={`absolute inset-2 rounded-full blur-md opacity-20 transition-colors duration-1000 ${ac.temp > 24 ? 'bg-orange-500' : 'bg-cyan-500'} animate-pulse`} />
                  <span className={`text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b ${getTempColor(ac.temp)} relative z-10`}>{ac.temp}°</span>
                  <span className="text-[8px] text-muted-foreground uppercase tracking-widest z-10">Target</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAc(s => ({ ...s, temp: Math.max(16, s.temp - 1) }))} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-cyan-400 transition-colors">
                  <Wind className="h-3 w-3" />
                </button>
                <button onClick={() => setAc(s => ({ ...s, temp: Math.min(30, s.temp + 1) }))} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-orange-400 transition-colors">
                  <Flame className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Strip Light Control */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-purple-400" />
              <span className="text-xs font-semibold text-foreground">Strip Light Control</span>
            </div>
            <button onClick={() => setAllLights(!lightsOn)} className={`transition-colors ${lightsOn ? "text-purple-400 drop-shadow-[0_0_8px_rgba(192,132,252,0.5)]" : "text-muted-foreground hover:text-purple-400/50"}`}>
              <Power className="h-4 w-4" />
            </button>
          </div>

          <div className={`flex flex-col gap-3 transition-opacity ${!lightsOn ? "pointer-events-none opacity-40" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Color</span>
              <button onClick={() => setShowPalette(!showPalette)} className="hover:bg-white/5 rounded p-0.5 transition-colors">
                <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${showPalette ? "rotate-180" : ""}`} />
              </button>
            </div>

            <div className="flex items-center gap-3 relative">
              <button onClick={() => setShowPalette(!showPalette)} className="h-5 w-8 shrink-0 rounded-md transition-colors border border-border" style={{ backgroundColor: sel.color }}></button>
              <div className="relative h-3 flex-1 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-cyan-500 via-blue-500 to-fuchsia-500 cursor-pointer">
                <input type="color" value={sel.color} onChange={(e) => updateStrip(selectedStrip, { color: e.target.value, power: true })} className="absolute inset-0 cursor-pointer opacity-0 w-full" />
                <div className="absolute left-[80%] top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 pointer-events-none rounded-full border-[1.5px] border-white shadow-sm ring-1 ring-black/20"></div>
              </div>

              {showPalette && (
                <div className="absolute left-0 top-full mt-2 z-50 flex w-[calc(100%+12px)] flex-wrap gap-2 rounded-lg border border-border bg-card p-2.5 shadow-xl">
                  {SWATCHES.map((sw) => (
                    <button key={sw.hex} title={sw.name}
                      onClick={() => { updateStrip(selectedStrip, { color: sw.hex, power: true }); setShowPalette(false); }}
                      className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${sel.color.toLowerCase() === sw.hex.toLowerCase() ? "border-white" : "border-white/20"}`}
                      style={{ backgroundColor: sw.hex }} />
                  ))}
                  <label className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full border border-white/20"
                    style={{ background: "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" }}>
                    <input type="color" value={sel.color} onChange={(e) => { updateStrip(selectedStrip, { color: e.target.value, power: true }); setShowPalette(false); }} className="absolute inset-0 cursor-pointer opacity-0" />
                  </label>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Brightness</span>
                <span className="text-[10px] text-muted-foreground">{sel.brightness}%</span>
              </div>
              <input type="range" min={0} max={100} value={sel.brightness} onChange={(e) => updateStrip(selectedStrip, { brightness: Number(e.target.value) })} className="h-1 w-full appearance-none rounded-full bg-muted accent-purple-500" />
            </div>

            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">Scene</span>
              <button className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[10px] text-foreground">
                Accent <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
