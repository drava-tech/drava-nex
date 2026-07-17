import type { WelcomeContent } from "./content";

/** Full-screen greeting: headline + tagline over a dark gradient, with an
 * optional looping video beneath it. */
export function WelcomeRenderer({ content }: { content?: WelcomeContent }) {
  const title = content?.title || "Welcome to Tusker Digital Experience Center";
  const subtitle = content?.subtitle;
  const videoUrl = content?.videoUrl;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "4vh",
        padding: "6vh 6vw",
        boxSizing: "border-box",
        background:
          "radial-gradient(circle at 50% 0%, #1c2733 0%, #0a0e14 55%, #000000 100%)",
        color: "#fff",
        fontFamily: "var(--font-sans, Geist, system-ui, sans-serif)",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.6vh" }}>
        <span
          style={{
            fontSize: "1.3vw",
            fontWeight: 600,
            letterSpacing: "0.5em",
            textTransform: "uppercase",
            color: "rgba(245, 190, 90, 0.85)",
          }}
        >
          Tusker Digital
        </span>
        <h1
          style={{
            fontSize: videoUrl ? "4.2vw" : "6vw",
            fontWeight: 800,
            lineHeight: 1.1,
            margin: 0,
            maxWidth: "80vw",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              fontSize: "1.6vw",
              fontWeight: 400,
              margin: 0,
              maxWidth: "60vw",
              color: "rgba(255,255,255,0.6)",
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {videoUrl ? (
        <div
          style={{
            width: "min(70vw, 1400px)",
            aspectRatio: "16 / 9",
            borderRadius: "1.5vw",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 0 8vw rgba(245, 190, 90, 0.12), 0 2vh 4vh rgba(0,0,0,0.5)",
          }}
        >
          <video
            src={videoUrl}
            autoPlay
            muted
            loop
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      ) : null}
    </div>
  );
}
