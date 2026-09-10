"use client";

/**
 * Shared pieces of the `/display/<kind>` viewers (sheet, word, slides, pdf) —
 * each is a full-screen client-side renderer loaded in an iframe as
 * `?src=<url>` (see mediaEmbedUrl in @platform/types).
 *
 * resolveSource in particular is a scheme/origin guard, so it lives in one
 * place rather than being copied per viewer where the copies could drift.
 */

/** Only same-origin/relative sources are loadable — anything else fails CORS anyway. */
export function resolveSource(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The viewers' one shared presentational state — loading, error, and empty all read as centred text. */
export function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a] p-8 text-center">
      <p className={`text-lg ${tone === "error" ? "text-red-400" : "text-zinc-400"}`}>{children}</p>
    </div>
  );
}
