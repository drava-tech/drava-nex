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

/** Longest a poster grab may take before it's abandoned (a huge or odd file). */
const POSTER_TIMEOUT_MS = 30_000;

/**
 * One frame of the video as PNG bytes, via ffmpeg (FFMPEG_PATH, or `ffmpeg` on
 * the PATH; the API image installs it). A second in, so a fade from black
 * doesn't give a black poster; the first frame for a clip shorter than that.
 * null when ffmpeg is missing or can't read the file.
 */
async function grabFrame(videoPath: string, atSeconds: number): Promise<Buffer | null> {
  const { spawn } = await import("child_process");
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(
        process.env["FFMPEG_PATH"] || "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-ss", String(atSeconds), "-i", videoPath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
        { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
      );
    } catch {
      return resolve(null);
    }
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => proc.kill("SIGKILL"), POSTER_TIMEOUT_MS);
    proc.stdout?.on("data", (c: Buffer) => chunks.push(c));
    proc.on("error", () => {
      clearTimeout(timer);
      resolve(null); // ffmpeg not installed
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      resolve(code === 0 && out.length > 0 ? out : null);
    });
  });
}

/**
 * A WebP poster for a video, next to it in `uploadDir` (same name and size as
 * an image's thumbnail), so the media grid and the Our Story carousel can show
 * a picture without loading the video. Best-effort like generateThumbnail:
 * null means "no poster", never an error.
 */
export async function generateVideoPoster(uploadDir: string, storedName: string): Promise<string | null> {
  const videoPath = path.join(uploadDir, storedName);
  const frame = (await grabFrame(videoPath, 1)) ?? (await grabFrame(videoPath, 0));
  if (!frame) {
    console.warn(`[thumbnails] no poster for ${storedName} (ffmpeg missing, or the file can't be read)`);
    return null;
  }
  return generateThumbnail(uploadDir, storedName, frame);
}

/** The thumbnail for a freshly stored file: a tile for images, a poster for videos, none otherwise. */
export async function thumbnailForUpload(
  type: string,
  uploadDir: string,
  storedName: string,
  source?: Buffer
): Promise<string | null> {
  if (type === "image") return generateThumbnail(uploadDir, storedName, source);
  if (type === "video") return generateVideoPoster(uploadDir, storedName);
  return null;
}
