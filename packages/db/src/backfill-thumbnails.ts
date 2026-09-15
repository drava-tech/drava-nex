/**
 * One-off backfill: generate a thumbnail for every image asset that predates
 * the thumbnail pipeline.
 *
 * New uploads get one in the upload route (apps/api/src/services/thumbnails.ts).
 * This covers everything already in the library — on the live set that was 160
 * images averaging 2.3 MB each, all of which the media grid and the broadcast
 * carousel were downloading in full to paint ~200px tiles.
 *
 * Safe to re-run: it only picks up rows whose thumbnail_url is still null, and
 * skips any whose thumbnail file already exists on disk.
 *
 * MUST RUN WHERE THE FILES ARE. Uploads live on a Docker volume mounted only
 * into the api container on the deployment host (see infra/docker/
 * docker-compose.yml); a dev checkout only has the handful of seed assets in
 * apps/cms/public/media. Running this locally against the shared database would
 * simply skip every row it cannot find — safe, but pointless. Run it on the
 * host, in the api container, with UPLOAD_DIR pointing at the volume:
 *
 *   UPLOAD_DIR=/app/media pnpm --filter @platform/db db:backfill-thumbnails
 *
 * Locally (dry run, to sanity-check wiring only):
 *   pnpm --filter @platform/db db:backfill-thumbnails -- --dry-run
 *
 * It never marks a row whose thumbnail it did not actually write, so a run in
 * the wrong place cannot leave the database pointing at files that do not exist.
 */
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { listMediaMissingThumbnails, setMediaThumbnail } from "./queries/media.js";

const UPLOAD_DIR =
  process.env["UPLOAD_DIR"] ??
  path.resolve(process.cwd(), "../../apps/cms/public/media");

const THUMB_MAX_EDGE = 800;
const THUMB_QUALITY = 72;
const dryRun = process.argv.includes("--dry-run");

const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function main() {
  let sharp: any;
  try {
    const mod = await import("sharp");
    sharp = mod.default ?? mod;
  } catch (err) {
    console.error(
      "sharp is required for the backfill. Run it from apps/api (which depends on it), " +
        "or `pnpm add -w sharp`.\n",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }

  console.log(`upload dir: ${UPLOAD_DIR}`);
  if (!fs.existsSync(UPLOAD_DIR)) {
    console.error("upload dir does not exist — set UPLOAD_DIR to the media volume.");
    process.exit(1);
  }
  if (dryRun) console.log("DRY RUN — nothing will be written\n");

  const rows = await listMediaMissingThumbnails(10_000);
  console.log(`${rows.length} image asset(s) without a thumbnail\n`);

  let done = 0, skipped = 0, failed = 0, before = 0, after = 0;

  for (const row of rows) {
    // url is "/media/<file>"; anything else (an absolute http link) has no
    // local file to read and is not ours to resize.
    const storedName = row.url.startsWith("/media/") ? path.basename(row.url) : null;
    if (!storedName) {
      skipped++;
      continue;
    }
    const srcPath = path.join(UPLOAD_DIR, storedName);
    if (!fs.existsSync(srcPath)) {
      console.warn(`  missing file, skipping: ${row.name} (${storedName})`);
      skipped++;
      continue;
    }

    const thumbName = `${path.parse(storedName).name}.thumb.webp`;
    const thumbPath = path.join(UPLOAD_DIR, thumbName);
    const srcBytes = (await fsPromises.stat(srcPath)).size;

    if (dryRun) {
      console.log(`  would resize ${row.name} — ${mb(srcBytes)}`);
      before += srcBytes;
      done++;
      continue;
    }

    try {
      if (!fs.existsSync(thumbPath)) {
        await sharp(srcPath, { failOn: "none" })
          .rotate()
          .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: THUMB_QUALITY })
          .toFile(thumbPath);
      }
      const outBytes = (await fsPromises.stat(thumbPath)).size;
      await setMediaThumbnail(row.id, `/media/${thumbName}`);
      before += srcBytes;
      after += outBytes;
      done++;
      console.log(`  ${row.name.slice(0, 44).padEnd(44)} ${mb(srcBytes).padStart(9)} -> ${kb(outBytes).padStart(8)}`);
    } catch (err) {
      failed++;
      console.warn(`  FAILED ${row.name}:`, err instanceof Error ? err.message : err);
      await fsPromises.rm(thumbPath, { force: true }).catch(() => {});
    }
  }

  console.log(`\ndone: ${done}   skipped: ${skipped}   failed: ${failed}`);
  if (!dryRun && done > 0) {
    console.log(`tile bytes: ${mb(before)} -> ${mb(after)}  (${(before / Math.max(after, 1)).toFixed(0)}x smaller)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
