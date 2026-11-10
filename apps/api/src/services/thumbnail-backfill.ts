import fs from "fs";
import path from "path";
import { listMediaMissingThumbnails, setMediaThumbnail } from "@platform/db";
import { UPLOAD_DIR } from "../routes/media.js";
import { broadcastToCms } from "../ws/gateway.js";
import { thumbnailForUpload } from "./thumbnails.js";

/** Wait after boot, so the API is serving before this starts reading files. */
const START_DELAY_MS = 60_000;

/**
 * Fill in the thumbnails the library is missing: images that came in before
 * thumbnails existed or by email, and every video (posters are new). Once per
 * boot, one file at a time, only rows whose file is on this machine.
 *
 * Runs only on the instance that holds the files (production, or
 * THUMBNAIL_BACKFILL=true). A dev API shares the database but not the files,
 * and writing a thumbnail that exists only on a laptop would leave production
 * pointing at nothing.
 */
export function thumbnailBackfillEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env["THUMBNAIL_BACKFILL"]?.trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return env["NODE_ENV"] === "production";
}

export function startThumbnailBackfill(): void {
  if (!thumbnailBackfillEnabled()) return;
  setTimeout(() => {
    void runThumbnailBackfill().catch((err) =>
      console.warn("[thumbnails] backfill stopped:", err instanceof Error ? err.message : err)
    );
  }, START_DELAY_MS).unref();
}

export async function runThumbnailBackfill(): Promise<{ made: number; skipped: number }> {
  const rows = await listMediaMissingThumbnails(10_000, ["image", "video"]);
  let made = 0;
  let skipped = 0;
  for (const row of rows) {
    const storedName = row.url.startsWith("/media/") ? path.basename(row.url) : null;
    if (!storedName || !fs.existsSync(path.join(UPLOAD_DIR, storedName))) {
      skipped++;
      continue;
    }
    const url = await thumbnailForUpload(row.type, UPLOAD_DIR, storedName);
    if (url) {
      await setMediaThumbnail(row.id, url);
      made++;
    } else {
      skipped++;
    }
  }
  if (rows.length) console.log(`[thumbnails] backfill: ${made} made, ${skipped} skipped`);
  if (made) broadcastToCms({ type: "MEDIA_LIBRARY_UPDATED" });
  return { made, skipped };
}
