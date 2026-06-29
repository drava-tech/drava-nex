// Resolves the base origin/path of the screens player app, used to embed a live
// mirror of a screen inside the CMS. Works in both modes, mirroring the screens
// app's own client-urls.ts logic:
//   • direct localhost dev (CMS :3000) → the standalone screens dev server :3001
//   • behind nginx → same-origin "/display" (override via NEXT_PUBLIC_SCREENS_URL)
function resolveScreensBase(): string {
  const configured = (process.env["NEXT_PUBLIC_SCREENS_URL"] ?? "").replace(/\/$/, "");
  const basePath = (process.env["NEXT_PUBLIC_SCREENS_BASE_PATH"] ?? "").replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const { hostname, port, protocol } = window.location;
    const isDirectDev =
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      (port === "3000" || port === "3001");
    if (isDirectDev) {
      if (configured && !configured.startsWith("/")) return configured;
      return `${protocol}//${hostname}:3001${basePath}`;
    }
  }

  if (configured) return configured;
  return basePath || "/display";
}

/**
 * URL of the screens player for a given screen, configured as an embedded live
 * mirror: the picker is hidden and it registers as a preview client (so it is
 * NOT counted as an online TV). Call client-side (it reads window.location).
 */
export function screenMirrorUrl(screenId: string): string {
  return `${resolveScreensBase()}/${encodeURIComponent(screenId)}?picker=false&preview=1`;
}

/**
 * URL of the screens player opened as an interactive control console (new tab):
 * the long-press content picker is on and touch-navigation is enabled, and it
 * registers as a preview client (not counted as an online TV). Interactions
 * there replicate to the real screen in realtime. Call client-side.
 */
export function screenControlUrl(screenId: string): string {
  return `${resolveScreensBase()}/${encodeURIComponent(screenId)}?preview=1`;
}
