import type { DisplayConfig, Content } from "@/types/display";
import type { WsContent } from "@platform/types";

// Server-side base URL for reaching the API gateway (http://api:4000 in Docker).
const INTERNAL_API_URL = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";

function wsContentToDisplayContent(ws: WsContent): Content {
  switch (ws.type) {
    case "video":
      return { id: ws.id, type: "video", source: ws.source, loop: ws.loop ?? true, muted: ws.muted ?? true };
    case "image":
      return { id: ws.id, type: "image", source: ws.source };
    case "html":
      return { id: ws.id, type: "html", source: ws.source };
    case "stream":
      return { id: ws.id, type: "stream", source: ws.source, muted: ws.muted ?? true };
    case "experience":
      return { id: ws.id, type: "experience", title: ws.title };
    default:
      return { id: ws.id, type: "video", source: ws.source, loop: true, muted: true };
  }
}

// ─── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve the content currently assigned to a screen by asking the API gateway
 * (DB-authoritative). The screens app never touches the database directly.
 */
export async function resolveDisplayConfig(screenId: string): Promise<DisplayConfig> {
  let res: Response;
  try {
    res = await fetch(
      `${INTERNAL_API_URL}/api/screens/${encodeURIComponent(screenId)}/config`,
      { cache: "no-store" }
    );
  } catch (cause) {
    throw new DisplayConfigError(
      `[display-config] Failed to reach API for "${screenId}": ${String(cause)}`,
      "INVALID_CONFIG"
    );
  }

  if (res.status === 404) {
    // No content assigned (or unknown screen) — show idle UI but keep WS alive.
    throw new DisplayConfigError(
      `No content assigned to screen "${screenId}"`,
      "CONTENT_NOT_FOUND"
    );
  }
  if (!res.ok) {
    throw new DisplayConfigError(
      `[display-config] API returned HTTP ${res.status} for "${screenId}"`,
      "INVALID_CONFIG"
    );
  }

  const data = (await res.json()) as { content: WsContent | null };
  if (!data.content) {
    throw new DisplayConfigError(
      `No content assigned to screen "${screenId}"`,
      "CONTENT_NOT_FOUND"
    );
  }

  return {
    screen: { screenId, screenName: screenId, contentId: "" },
    content: wsContentToDisplayContent(data.content),
  };
}

// ─── Custom Error ─────────────────────────────────────────────────────────────

export type DisplayErrorCode =
  | "SCREEN_NOT_FOUND"
  | "CONTENT_NOT_FOUND"
  | "INVALID_CONFIG";

export class DisplayConfigError extends Error {
  constructor(
    message: string,
    public readonly code: DisplayErrorCode
  ) {
    super(message);
    this.name = "DisplayConfigError";
  }
}
