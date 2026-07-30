"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { LIQUID_BASE, liquidGlowStyle } from "./liquid-glass";
import { LiquidShine } from "./liquid-pill";

export function RefreshButton() {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  return (
    <button
      type="button"
      aria-label="Refresh dashboard"
      onClick={() => {
        setSpinning(true);
        router.refresh();
        setTimeout(() => setSpinning(false), 600);
      }}
      className={`${LIQUID_BASE} h-9 w-9 shrink-0 p-0`}
      style={liquidGlowStyle("blue")}
    >
      <LiquidShine />
      <RefreshCw className={`relative z-10 h-4 w-4 text-white ${spinning ? "animate-spin" : ""}`} />
    </button>
  );
}
