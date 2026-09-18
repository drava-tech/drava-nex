import type { MediaAssetRow } from "@workspace/db"
import { IDLE_CONTENT, type ScreenContent } from "@workspace/types"

import { media, mediaSourceUrl } from "./media"
import { screens } from "./screens"

/** Document viewers served by the console (M13). Relative: same origin as the player. */
const VIEWERS: Partial<Record<MediaAssetRow["type"], string>> = {
  document: "/display/pdf",
  sheet: "/display/sheet",
  presentation: "/display/slides",
  word: "/display/word",
}

/**
 * Turns a media row into what a screen renders. Anything that is not an image
 * or a video becomes `html`: a pasted page, or a document viewer route with
 * the file's URL as a parameter.
 */
export function toScreenContent(row: MediaAssetRow, opts: { asDefault?: boolean } = {}): ScreenContent {
  const source = mediaSourceUrl(row)
  const base = { id: row.id, title: row.name }
  if (row.type === "image") return { ...base, type: "image", source }
  if (row.type === "video") {
    // A pushed video plays once with sound; the idle default loops silently.
    return opts.asDefault
      ? { ...base, type: "video", source, loop: true, muted: true }
      : { ...base, type: "video", source, loop: false, muted: false }
  }
  const viewer = VIEWERS[row.type]
  if (viewer) return { ...base, type: "html", source: `${viewer}?src=${encodeURIComponent(source)}` }
  return { ...base, type: "html", source }
}

/**
 * What a screen should show right now, straight from the database: its
 * current item, else its default item, else idle. The database is the source
 * of truth; the gateway only caches the answer.
 */
export async function resolveScreenContent(screenId: string): Promise<ScreenContent> {
  const screen = await screens.get(screenId)
  if (!screen) return IDLE_CONTENT
  if (screen.currentMediaId) {
    const row = await media.get(screen.currentMediaId)
    if (row) return toScreenContent(row)
  }
  if (screen.defaultMediaId) {
    const row = await media.get(screen.defaultMediaId)
    if (row) return toScreenContent(row, { asDefault: true })
  }
  return IDLE_CONTENT
}
