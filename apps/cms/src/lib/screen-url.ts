// The display player is served by the CMS itself at /display. Single-origin:
// same-origin relative path, unless an absolute NEXT_PUBLIC_SCREENS_URL override
// is provided. No hostname/port sniffing.
function resolveScreensBase(): string {
  return (process.env["NEXT_PUBLIC_SCREENS_URL"] || "/display").replace(/\/$/, "");
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
