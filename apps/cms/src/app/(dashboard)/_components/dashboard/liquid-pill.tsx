import React from "react";
import Link from "next/link";

// Flat pill shell — no blur/shine/glow, just the violet border + hover lift.
const PILL_SHELL =
  "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full border border-[#432992] bg-transparent transition-all duration-200 hover:-translate-y-0.5";

interface LiquidPillProps {
  children: React.ReactNode;
  href?: string;
  className?: string;
}

// Polymorphic pill: renders as a real link when `href` is given, otherwise a
// plain span (for static badges/chips).
export function LiquidPill({ children, href, className = "" }: LiquidPillProps) {
  const classes = `${PILL_SHELL} px-3.5 py-1.5 text-xs font-medium text-white ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return <span className={classes}>{children}</span>;
}
