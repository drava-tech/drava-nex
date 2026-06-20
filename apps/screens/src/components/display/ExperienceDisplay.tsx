interface ExperienceDisplayProps {
  title?: string;
  screenId?: string;
}

export function ExperienceDisplay({ title, screenId }: ExperienceDisplayProps) {
  if (!title) {
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
          {screenId ? `SCREEN · ${screenId}` : "STANDBY"}
        </p>
      </div>
    );
  }

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
        gap: "20px",
        padding: "48px",
        boxSizing: "border-box",
      }}
    >
      <p
        style={{
          color: "rgba(255,255,255,0.3)",
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          margin: 0,
        }}
      >
        Now Playing
      </p>
      <h1
        style={{
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
          fontSize: "clamp(40px, 8vw, 120px)",
          fontWeight: 300,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          textAlign: "center",
          lineHeight: 1.05,
          margin: 0,
          maxWidth: "80%",
        }}
      >
        {title}
      </h1>
    </div>
  );
}
