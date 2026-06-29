// Resolves the base path of the screens player app used by CMS mirrors and
// control links. Local dev proxies /display through the CMS dev server on
// localhost:3000; Docker/LAN routes /display through nginx.
function resolveScreensBase(): string {
  const configured = (process.env["NEXT_PUBLIC_SCREENS_URL"] ?? "").replace(/\/$/, "");
  const basePath = (process.env["NEXT_PUBLIC_SCREENS_BASE_PATH"] ?? "").replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const { hostname, port } = window.location;
    const isDirectDev =
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      (port === "3000" || port === "3001");
    if (isDirectDev) return configured || basePath || "/display";
  }

  if (configured) return configured;
  return basePath || "/display";
}

/**
 * URL of the screens player for a given screen, configured as an embedded live
 * mirror: the picker is hidden and it registers as a preview client, so it is
 * not counted as an online TV.
 */
export function screenMirrorUrl(screenId: string): string {
  return `${resolveScreensBase()}/${encodeURIComponent(screenId)}?picker=false&preview=1`;
}

/**
 * URL of the screens player opened as an interactive control console.
 */
export function screenControlUrl(screenId: string): string {
  return `${resolveScreensBase()}/${encodeURIComponent(screenId)}?preview=1`;
}
