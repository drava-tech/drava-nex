import { mediaRepo, type MediaAssetRow } from "@workspace/db"
import { publicObjectUrl } from "@workspace/storage"
import type { MediaItem } from "@workspace/types"

import { db } from "../lib/db"
import { storage } from "../lib/storage"

export const media = mediaRepo(db)

/**
 * The URL a browser (console or screen) loads for an object. Derived at read
 * time — rows store bucket + key, never URLs.
 *
 * - Public custom domain configured → a stable CDN URL (the production default).
 * - Otherwise → our own redirect route, which 302s to a fresh presigned URL.
 *
 * Either way the URL is stable for the life of the asset. That matters: a
 * signed URL expires mid-playback, and the player treats a changed `source`
 * as new content and re-runs the transition.
 */
function objectUrl(row: MediaAssetRow, key: string, variant: "original" | "thumb"): string {
  const direct = storage ? publicObjectUrl(storage, key) : null
  if (direct) return direct
  return `/api/media/${row.id}/file${variant === "thumb" ? "?variant=thumb" : ""}`
}

export function mediaSourceUrl(row: MediaAssetRow): string {
  if (row.externalUrl) return row.externalUrl
  return objectUrl(row, row.objectKey!, "original")
}

export function toMediaDto(row: MediaAssetRow): MediaItem {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    url: mediaSourceUrl(row),
    thumbnailUrl: row.thumbObjectKey ? objectUrl(row, row.thumbObjectKey, "thumb") : null,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  }
}
