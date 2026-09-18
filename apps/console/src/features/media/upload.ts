import { classifyUpload, type MediaItem, type PresignUploadResponse } from "@workspace/types"

import { api, ApiError } from "@/lib/api"
import { makeThumbnail } from "./thumbnail"

/**
 * PUT with progress. XMLHttpRequest, not fetch: fetch has no upload-progress
 * event, and a multi-hundred-megabyte upload without a progress bar is
 * unusable.
 */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (fraction: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    // Exactly the headers returned by presign — Content-Type is signed.
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError("STORAGE_UNAVAILABLE", `Storage rejected the upload (${xhr.status})`, xhr.status))
    // A CORS rejection surfaces as a bare network error with status 0.
    xhr.onerror = () =>
      reject(new ApiError("NETWORK", "Upload failed — network error or bucket CORS policy", 0))
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"))
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

export type UploadPhase = "preparing" | "uploading" | "saving"

/** presign → (thumbnail) → PUT to storage → commit. Throws on failure. */
export async function uploadFile(
  file: File,
  opts: { onProgress: (fraction: number, phase: UploadPhase) => void; signal: AbortSignal }
): Promise<MediaItem> {
  const kind = classifyUpload(file.name)
  if (!kind) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "This file type can't be shown on a screen", 415)
  const wantsThumb = kind.type === "image" || kind.type === "video"

  opts.onProgress(0, "preparing")
  const [presign, thumb] = await Promise.all([
    api<PresignUploadResponse>("/api/media/uploads/presign", {
      method: "POST",
      json: { fileName: file.name, sizeBytes: file.size, withThumbnail: wantsThumb },
      signal: opts.signal,
    }),
    wantsThumb ? makeThumbnail(file, kind.type as "image" | "video") : Promise.resolve(null),
  ])

  await putWithProgress(presign.uploadUrl, presign.headers, file, (f) => opts.onProgress(f, "uploading"), opts.signal)

  let thumbnailUploaded = false
  if (thumb && presign.thumbnail) {
    try {
      await putWithProgress(presign.thumbnail.uploadUrl, presign.thumbnail.headers, thumb, () => {}, opts.signal)
      thumbnailUploaded = true
    } catch (err) {
      if (opts.signal.aborted) throw err
      // Best effort — the upload itself already succeeded.
    }
  }

  opts.onProgress(1, "saving")
  return api<MediaItem>("/api/media/commit", {
    method: "POST",
    json: { ticket: presign.ticket, name: file.name, thumbnailUploaded },
    signal: opts.signal,
  })
}
