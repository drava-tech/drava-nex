"use client";

interface ContentTitleOverlayProps {
  title: string;
}

export function ContentTitleOverlay({ title }: ContentTitleOverlayProps) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "24px",
        left: "24px",
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        backgroundColor: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(8px)",
        borderRadius: "100px",
        padding: "6px 14px 6px 10px",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: "#4ade80",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: "#fff",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.05em",
          fontFamily: "system-ui, sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
    </div>
  );
}
