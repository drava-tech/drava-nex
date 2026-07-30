import React from "react";
import Link from "next/link";
import {
  LIQUID_BASE,
  liquidGlowFromColor,
  liquidGlowStyle,
  type LiquidAccent,
} from "./liquid-glass";

// The bright streak across the top of the glass — the thing that sells the
// "liquid" read. Sits above the fill, below the label.
export function LiquidShine() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-1 top-0 h-1/2 rounded-full bg-gradient-to-b from-white/35 to-transparent"
    />
  );
}

interface LiquidPillProps {
  children: React.ReactNode;
  accent?: LiquidAccent;
  color?: string; // raw CSS color, overrides `accent` when set
  href?: string;
  className?: string;
}

// Polymorphic glass pill: renders as a real link when `href` is given,
// otherwise a plain span (for static badges/chips).
export function LiquidPill({ children, accent = "slate", color, href, className = "" }: LiquidPillProps) {
  const classes = `${LIQUID_BASE} px-3.5 py-1.5 text-xs font-medium text-white ${className}`;
  const style = color ? liquidGlowFromColor(color) : liquidGlowStyle(accent);

  const inner = (
    <>
      <LiquidShine />
      <span className="relative z-10 flex items-center gap-1.5">{children}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} style={style}>
        {inner}
      </Link>
    );
  }

  return (
    <span className={classes} style={style}>
      {inner}
    </span>
  );
}
