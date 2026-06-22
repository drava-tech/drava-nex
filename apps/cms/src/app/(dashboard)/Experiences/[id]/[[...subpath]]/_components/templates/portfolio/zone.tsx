import React from "react";

/** A dashed placeholder zone inside the 1920×1080 stage (sizes in real px). */
export function Zone({
  label,
  hint,
  style,
  className,
}: {
  label: string;
  hint?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-[20px] border-2 border-dashed border-white/15 bg-white/[0.03] text-center ${className ?? ""}`}
      style={style}
    >
      <span
        className="font-semibold uppercase text-white/70"
        style={{ fontSize: 26, letterSpacing: "0.18em" }}
      >
        {label}
      </span>
      {hint && (
        <span className="text-white/30" style={{ marginTop: 8, fontSize: 16 }}>
          {hint}
        </span>
      )}
    </div>
  );
}
