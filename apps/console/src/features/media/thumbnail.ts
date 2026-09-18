/**
 * Small preview tiles, made in the browser from the file the user just picked.
 *
 * The bytes go straight to storage and never pass through the API, so the
 * server cannot make thumbnails without downloading the file back — absurd for
 * a 1 GB video. The browser already has it in hand.
 *
 * Best-effort by contract: any failure resolves to null, and the upload
 * continues without a tile (consumers fall back to the original).
 */

const MAX_EDGE = 800
const QUALITY = 0.72
const TIMEOUT_MS = 10_000

function fit(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/**
 * True when nothing was actually drawn. Drawing a <video> that has no decoded
 * frame yet silently paints nothing — and a transparent tile uploaded as the
 * poster is worse than no tile, because consumers only fall back to the
 * original when the thumbnail is missing.
 */
function isBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height)
  // Sample a coarse grid; any visible pixel means a real frame.
  const step = Math.max(1, Math.floor((width * height) / 2000)) * 4
  for (let i = 3; i < data.length; i += step) if (data[i] !== 0) return false
  return true
}

async function encode(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const { width, height } = fit(w, h)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, width, height)
  if (isBlank(ctx, width, height)) return null
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", QUALITY))
}

async function fromImage(file: File): Promise<Blob | null> {
  // imageOrientation honours EXIF rotation, as the original is displayed.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    return await encode(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

/**
 * Seeks a detached <video> to ~1 s and grabs that frame. This works only
 * because a blob: URL is same-origin, so the canvas is not tainted — the same
 * code against a storage URL would need CORS and crossOrigin="anonymous".
 *
 * The frame is drawn only once the element reports HAVE_CURRENT_DATA. Drawing
 * right after `seeked` or `loadedmetadata` can hit a frame that is not decoded
 * yet, which paints nothing at all.
 */
function fromVideo(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    let settled = false
    let seeked = false
    const finish = (blob: Blob | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Release fully, or the detached element keeps pulling the file.
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(url)
      resolve(blob)
    }
    const timer = setTimeout(() => finish(null), TIMEOUT_MS)

    // Even at HAVE_CURRENT_DATA the first draw occasionally comes back empty
    // (the decoded frame is not yet available to the canvas), so a blank
    // capture is retried a few times before giving up.
    let grabbing = false
    const attempt = (tries: number) => {
      encode(video, video.videoWidth, video.videoHeight).then(
        (blob) => {
          if (blob || tries <= 1) finish(blob)
          else setTimeout(() => attempt(tries - 1), 150)
        },
        () => finish(null)
      )
    }
    const grab = () => {
      if (settled || grabbing || !seeked || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
      if (!video.videoWidth || !video.videoHeight) return finish(null)
      grabbing = true
      attempt(4)
    }

    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    video.onerror = () => finish(null)
    video.onloadeddata = () => {
      // Recorded WebM often reports an Infinity duration; 0.5 s is a safe guess.
      const target = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0.5
      video.currentTime = target
    }
    video.onseeked = () => {
      seeked = true
      grab()
    }
    // If the seek landed before the frame was decoded, this fires once it is.
    video.oncanplay = grab
    video.src = url
  })
}

export async function makeThumbnail(file: File, type: "image" | "video"): Promise<Blob | null> {
  try {
    const work = type === "image" ? fromImage(file) : fromVideo(file)
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS))
    return await Promise.race([work, timeout])
  } catch {
    return null
  }
}
