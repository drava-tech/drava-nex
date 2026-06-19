"use server";

import { readScreensJson, readContentsJson } from "./config-writer";
import type { WsContent } from "@platform/types";

export async function broadcastContentUpdate(screenId: string): Promise<void> {
  const [screensConfig, contentsConfig] = await Promise.all([
    readScreensJson(),
    readContentsJson(),
  ]);

  const screen = screensConfig.screens.find(
    (s: { screenId: string }) => s.screenId === screenId
  );
  if (!screen) return;

  const raw = contentsConfig.contents.find(
    (c: { id: string }) => c.id === screen.contentId
  );
  if (!raw) return;

  const content: WsContent = {
    id: raw.id,
    type: raw.type ?? "video",
    source: raw.source,
    loop: raw.loop,
    muted: raw.muted,
  };

  const apiUrl = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";
  const secret = process.env["BROADCAST_SECRET"] ?? "dev-secret";

  try {
    await fetch(`${apiUrl}/api/internal/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-broadcast-secret": secret,
      },
      body: JSON.stringify({ screenId, content, source: "cms" }),
    });
  } catch (err) {
    console.error("[broadcast] Failed to notify API for screen", screenId, err);
    // Non-fatal: the CMS saved the change; screen recovers on reconnect
  }
}

export async function broadcastWsContentDirect(
  screenId: string,
  content: WsContent
): Promise<void> {
  const apiUrl = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";
  const secret = process.env["BROADCAST_SECRET"] ?? "dev-secret";

  try {
    await fetch(`${apiUrl}/api/internal/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-broadcast-secret": secret,
      },
      body: JSON.stringify({ screenId, content, source: "cms" }),
    });
  } catch (err) {
    console.error("[broadcast] broadcastWsContentDirect failed for screen", screenId, err);
  }
}
