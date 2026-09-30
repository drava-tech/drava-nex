interface IdleDisplayProps {
  screenId: string;
}

export function IdleDisplay({ screenId }: IdleDisplayProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#000",
        gap: "24px",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/Logo.svg"
        alt="Logo"
        style={{
          // Explicit width: an SVG has no intrinsic pixel size, so maxWidth
          // alone would leave it at the browser's 300px default.
          width: "30vw",
          maxHeight: "30vh",
          objectFit: "contain",
        }}
      />
      <p
        style={{
          color: "rgba(255,255,255,0.2)",
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          margin: 0,
        }}
      >
        {`SCREEN · ${screenId}`}
      </p>
    </div>
  );
}
