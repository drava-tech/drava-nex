import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LiveScreenPlayer } from "@/app/display/_components/LiveScreenPlayer";
import { DisplayConfigError, resolveDisplayConfig } from "@/lib/display/display-config";

export const dynamic = "force-dynamic";

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

interface PageProps {
  params: Promise<{ screenId: string }>;
  searchParams: Promise<{ preview?: string }>;
}

export default async function DisplayPage({ params, searchParams }: PageProps) {
  const [{ screenId }, sp] = await Promise.all([params, searchParams]);
  const preview = sp.preview === "1" || sp.preview === "true";
  const wsUrl = process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/";

  try {
    const config = await resolveDisplayConfig(screenId);

    return (
      <Suspense fallback={<LoadingDisplay />}>
        <style>{`html,body{margin:0;padding:0;overflow:hidden;background:#000}`}</style>
        <LiveScreenPlayer
          screenId={screenId}
          initialContent={config.content}
          wsUrl={wsUrl}
          preview={preview}
        />
      </Suspense>
    );
  } catch (error) {
    if (error instanceof DisplayConfigError) {
      if (error.code === "SCREEN_NOT_FOUND") notFound();

      if (error.code === "CONTENT_NOT_FOUND") {
        // No content assigned yet — show idle UI but keep WebSocket alive
        // so the screen auto-updates the moment the CMS assigns something.
        return (
          <>
            <style>{`html,body{margin:0;padding:0;overflow:hidden;background:#000}`}</style>
            <LiveScreenPlayer
              screenId={screenId}
              initialContent={null}
              wsUrl={wsUrl}
              preview={preview}
            />
          </>
        );
      }

      return <DisplayError code={error.code} message={error.message} />;
    }
    throw error;
  }
}

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

function DisplayError({ code, message }: { code: string; message: string }) {
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
