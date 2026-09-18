import { deleteObject, listObjects } from "@workspace/storage"

import { storage } from "../lib/storage"
import { media } from "./media"

const GRACE_MS = 24 * 3600_000

/**
 * Deletes objects under media/ that no live row points at and that are older
 * than a day. They come from uploads that were never committed (a closed tab,
 * a failed commit) and from deletes whose storage call failed.
 *
 * Needed because a presigned PUT cannot be revoked or size-capped once issued:
 * the grace period covers the longest upload window we ever sign (6 h) with
 * plenty to spare.
 */
export async function reapOrphans(now = Date.now()): Promise<{ scanned: number; deleted: number }> {
  if (!storage) return { scanned: 0, deleted: 0 }
  const [objects, referenced] = await Promise.all([listObjects(storage, "media/"), media.referencedKeys()])
  let deleted = 0
  for (const obj of objects) {
    if (referenced.has(obj.key)) continue
    if (now - obj.lastModified.getTime() < GRACE_MS) continue
    try {
      await deleteObject(storage, obj.key)
      deleted++
    } catch (err) {
      console.warn(`[reaper] could not delete ${obj.key}:`, err)
    }
  }
  if (deleted) console.log(`[reaper] removed ${deleted} orphaned object(s) of ${objects.length}`)
  return { scanned: objects.length, deleted }
}

/** Runs the reaper 10 minutes after boot and every 6 hours after that. */
export function startReaper(): () => void {
  const run = () => void reapOrphans().catch((err) => console.error("[reaper] run failed:", err))
  const first = setTimeout(run, 10 * 60_000)
  const every = setInterval(run, 6 * 3600_000)
  first.unref()
  every.unref()
  return () => {
    clearTimeout(first)
    clearInterval(every)
  }
}
