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
        gap: "12px",
      }}
    >
      <span
        style={{
          display: "block",
          width: "32px",
          height: "1px",
          backgroundColor: "rgba(255,255,255,0.15)",
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
