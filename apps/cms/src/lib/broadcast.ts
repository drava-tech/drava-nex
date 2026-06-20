"use server";

import type { WsContent } from "@platform/types";

/**
 * Push a screen's content to the API gateway, which fans it out over WebSocket
 * to the connected screen(s) and to CMS browser tabs. Best-effort: if the API
 * is momentarily unreachable, the DB already holds the truth and the screen
 * re-syncs on its next connect.
 */
export async function broadcastWsContentDirect(
  screenId: string,
  content: WsContent
): Promise<void> {
  const apiUrl = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";
  const secret = process.env["BROADCAST_SECRET"] || "dev-secret";

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
