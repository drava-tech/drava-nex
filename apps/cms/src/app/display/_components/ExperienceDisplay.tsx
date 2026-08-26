"use client";

import { useState, useEffect } from "react";
import { useReplayableWindowEvent } from "@platform/ui";

interface ExperienceDisplayProps {
  title?: string;
  screenId?: string;
}

export function ExperienceDisplay({ title, screenId }: ExperienceDisplayProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const customEvent = e as CustomEvent<{ direction: "next" | "prev" }>;
      const dir = customEvent.detail.direction;
      if (dir === "next") {
        setCurrentSlide((prev) => (prev + 1) % 3);
      } else if (dir === "prev") {
        setCurrentSlide((prev) => (prev - 1 + 3) % 3);
      }
    };
    window.addEventListener("screen-navigate", handleNavigate);
    return () => window.removeEventListener("screen-navigate", handleNavigate);
  }, []);

  useReplayableWindowEvent<{ slideIndex: number }>("screen-set-slide", (detail) => {
    setCurrentSlide(detail.slideIndex);
  });

  if (!title) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen bg-zinc-950 text-zinc-50 gap-4">
        <div className="w-12 h-1 bg-zinc-800 rounded" />
        <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-zinc-500">
          {screenId ? `Screen · ${screenId}` : "Standby"}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen bg-zinc-950 text-zinc-50 font-sans overflow-hidden flex items-center justify-center">
      {/* Slide 1: Overview */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center p-8 md:p-12 transition-all duration-700 ease-in-out ${
          currentSlide === 0
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4 pointer-events-none"
        }`}
      >
        <span className="px-3 py-1 rounded-full text-[10px] font-semibold tracking-wider uppercase bg-zinc-900 border border-zinc-800 text-zinc-400 mb-6">
          {title}
        </span>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-center max-w-[800px] mb-4 text-white">
          Connected Digital Signage Network
        </h1>
        <p className="text-base md:text-xl text-zinc-400 text-center max-w-[600px] leading-relaxed">
          Real-time state synchronization, remote player control, and dynamic media scheduling powered by Hono API.
        </p>
      </div>

      {/* Slide 2: Key Features */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center p-8 md:p-12 transition-all duration-700 ease-in-out ${
          currentSlide === 1
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4 pointer-events-none"
        }`}
      >
        <span className="px-3 py-1 rounded-full text-[10px] font-semibold tracking-wider uppercase bg-zinc-900 border border-zinc-800 text-zinc-400 mb-8">
          Core Features
        </span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-[900px]">
          {[
            {
              name: "Remote Control",
              desc: "Reload browser, control audio, and change layouts remotely from the CMS control pad.",
            },
            {
              name: "Real-Time Sync",
              desc: "Sub-second state propagation with WebSocket Gateway and auto-reconnecting HTTP fallback.",
            },
            {
              name: "Scale & Reliability",
              desc: "Manage multiple screen channels from a single workspace with robust db schema monitoring.",
            },
          ].map((feat, idx) => (
            <div
              key={idx}
              className="p-6 rounded-xl bg-zinc-900/50 border border-zinc-800 shadow-lg flex flex-col gap-2"
            >
              <h3 className="text-base font-semibold text-zinc-100">{feat.name}</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Slide 3: Metrics */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center p-8 md:p-12 transition-all duration-700 ease-in-out ${
          currentSlide === 2
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4 pointer-events-none"
        }`}
      >
        <span className="px-3 py-1 rounded-full text-[10px] font-semibold tracking-wider uppercase bg-zinc-900 border border-zinc-800 text-zinc-400 mb-10">
          System Metrics
        </span>
        <div className="flex flex-wrap gap-6 justify-center max-w-[900px]">
          {[
            { label: "Connection", val: "CONNECTED", desc: "Active WebSocket tunnel", success: true },
            { label: "Channel Latency", val: "< 15ms", desc: "Real-time responses" },
            { label: "Status", val: "ONLINE", desc: "duplex stream online", success: true },
          ].map((metric, idx) => (
            <div
              key={idx}
              className="w-56 p-6 rounded-xl bg-zinc-900/50 border border-zinc-800 flex flex-col items-center text-center gap-1.5"
            >
              <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
                {metric.label}
              </span>
              <span className={`text-xl font-bold ${metric.success ? "text-emerald-500" : "text-zinc-100"}`}>
                {metric.val}
              </span>
              <span className="text-[11px] text-zinc-400">{metric.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Slide Indicators */}
      <div className="absolute bottom-10 flex gap-2.5 z-10">
        {[0, 1, 2].map((idx) => (
          <button
            key={idx}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("screen-control", { detail: { command: "SET_SLIDE", value: idx } })
              )
            }
            className={`h-2 rounded-full transition-all duration-300 ${
              currentSlide === idx ? "w-7 bg-zinc-100" : "w-2 bg-zinc-800 hover:bg-zinc-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
