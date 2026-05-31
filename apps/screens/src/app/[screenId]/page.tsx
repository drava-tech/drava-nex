import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveDisplayConfig, DisplayConfigError } from "@/lib/display-config";
import { ContentRenderer } from "@/components/display/ContentRenderer";

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ screenId: string }>;
}): Promise<Metadata> {
  const { screenId } = await params;
  return {
    title: `Display · ${screenId}`,
    description: `Digital signage display for screen ${screenId}`,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ screenId: string }>;
}

export default async function DisplayPage({ params }: PageProps) {
  const { screenId } = await params;

  let config;

  try {
    config = await resolveDisplayConfig(screenId);
  } catch (error) {
    if (error instanceof DisplayConfigError) {
      if (error.code === "SCREEN_NOT_FOUND") {
        // Triggers Next.js 404 page
        notFound();
      }

      // Other known errors — render a readable message
      return <DisplayError code={error.code} message={error.message} />;
    }

    // Unknown errors — re-throw so Next.js error boundary catches it
    throw error;
  }

  return (
    <Suspense fallback={<LoadingDisplay />}>
      {/* Global CSS reset for fullscreen display */}
      <style>{`
        html, body { margin: 0; padding: 0; overflow: hidden; background: #000; }
      `}</style>

      <ContentRenderer content={config.content} />
    </Suspense>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingDisplay() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#6b7280",
        fontFamily: "system-ui, sans-serif",
        fontSize: "1rem",
        letterSpacing: "0.1em",
      }}
    >
      Loading display...
    </div>
  );
}

function DisplayError({
  code,
  message,
}: {
  code: string;
  message: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#f87171",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <span style={{ fontSize: "0.75rem", opacity: 0.5, letterSpacing: "0.15em" }}>
        {code}
      </span>
      <p style={{ fontSize: "1.1rem", margin: 0 }}>{message}</p>
    </div>
  );
}
