import fsPromises from "fs/promises";
import path from "path";

/**
 * Derived thumbnails for image assets.
 *
 * The media grid and the /broadcast carousel draw ~200px tiles but were loading
 * the original upload. Measured on the live library: 20 tiles pulled 15.8 MB of
 * originals (one of them a 9.4 MB JPEG), against 11 KB of JSON for the same
 * page — the images outweighed everything else by roughly three orders of
 * magnitude, so this is the change that actually makes the UI feel fast.
 *
 * Generation is deliberately best-effort. A thumbnail is an optimisation, not
 * content: if sharp is unavailable or a file is malformed, the asset still
 * uploads and every consumer falls back to the original via mediaThumbnailSrc().
 */

/** Long edge in px. Tiles render ~200-400px wide; 2x covers retina. */
const THUMB_MAX_EDGE = 800;
const THUMB_QUALITY = 72;
export const THUMB_SUFFIX = ".thumb.webp";

/**
 * sharp ships prebuilt platform binaries and is a heavy native module, so it is
 * imported lazily — the API boots (and every non-upload request runs) without
 * paying for it, and a missing/broken install degrades to "no thumbnails"
 * rather than a server that won't start.
 */
async function loadSharp(): Promise<any | null> {
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch (err) {
    console.warn(
      "[thumbnails] sharp unavailable — serving original images as tiles:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** `<uuid>.jpg` -> `<uuid>.thumb.webp`, alongside the original in UPLOAD_DIR. */
export function thumbnailNameFor(storedName: string): string {
  return `${path.parse(storedName).name}${THUMB_SUFFIX}`;
}

/**
 * Write a WebP thumbnail next to `storedName` in `uploadDir`.
 *
 * Returns the public URL to store on the row, or null if a thumbnail could not
 * be produced for any reason — callers must treat null as "use the original",
 * never as an error.
 */
export async function generateThumbnail(
  uploadDir: string,
  storedName: string,
  source?: Buffer
): Promise<string | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;

  const thumbName = thumbnailNameFor(storedName);
  const thumbPath = path.join(uploadDir, thumbName);

  try {
    const input = source ?? (await fsPromises.readFile(path.join(uploadDir, storedName)));
    await sharp(input, { failOn: "none" })
      // withoutEnlargement: a small image stays its own size rather than being
      // upscaled into a file bigger than the original it is meant to replace.
      .rotate() // honour EXIF orientation before resizing
      .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(thumbPath);
    return `/media/${thumbName}`;
  } catch (err) {
    console.warn(
      `[thumbnails] could not generate for ${storedName}:`,
      err instanceof Error ? err.message : err
    );
    // Don't leave a half-written file behind for the file server to serve.
    await fsPromises.rm(thumbPath, { force: true }).catch(() => {});
    return null;
  }
}
