import { z } from "zod"

export const mediaTypeSchema = z.enum(["image", "video", "document", "sheet", "presentation", "word", "link"])
export type MediaType = z.infer<typeof mediaTypeSchema>

/**
 * Upload allowlist, shared by the console (file-picker `accept`, early
 * rejection) and the API (the actual enforcement).
 *
 * - SVG is excluded: served from our origin it is a stored-XSS vector.
 * - Legacy binary .xls / .ppt / .doc are excluded: the viewers read the Open XML
 *   formats only, so accepting them would just fail later — on a screen.
 */
export const UPLOAD_RULES = {
  image: {
    contentTypes: {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".avif": "image/avif",
    },
  },
  video: {
    contentTypes: {
      ".mp4": "video/mp4",
      ".m4v": "video/mp4",
      ".webm": "video/webm",
      ".ogg": "video/ogg",
      ".mov": "video/quicktime",
    },
  },
  document: { contentTypes: { ".pdf": "application/pdf" } },
  sheet: {
    contentTypes: {
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".csv": "text/csv",
    },
  },
  presentation: {
    contentTypes: {
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
  },
  word: {
    contentTypes: {
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  },
} as const satisfies Record<Exclude<MediaType, "link">, { contentTypes: Record<string, string> }>

export type UploadableType = keyof typeof UPLOAD_RULES

/** Every accepted extension, for an `<input type="file" accept>`. */
export const UPLOAD_ACCEPT = Object.values(UPLOAD_RULES)
  .flatMap((rule) => Object.keys(rule.contentTypes))
  .join(",")

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase()
}

/**
 * Classify a file by extension against the allowlist. The returned
 * `contentType` is ours, derived from the extension — never the browser's
 * claim — so an object always lands in storage with a type a `<video>` plays.
 */
export function classifyUpload(
  fileName: string
): { type: UploadableType; ext: string; contentType: string } | null {
  const ext = extensionOf(fileName)
  for (const [type, rule] of Object.entries(UPLOAD_RULES) as [
    UploadableType,
    { contentTypes: Record<string, string> },
  ][]) {
    const contentType = rule.contentTypes[ext]
    if (contentType) return { type, ext, contentType }
  }
  return null
}

export const mediaItemSchema = z.object({
  id: z.string(),
  type: mediaTypeSchema,
  name: z.string(),
  /** Where a browser loads the full file from. */
  url: z.string(),
  /** Small preview tile, or null — consumers fall back to `url`. */
  thumbnailUrl: z.string().nullable(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  createdAt: z.string(),
})
export type MediaItem = z.infer<typeof mediaItemSchema>

// ─── Upload: presign → PUT to R2 → commit ────────────────────────────────────

export const presignUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  /** Whether the browser will also upload a thumbnail tile. */
  withThumbnail: z.boolean().default(false),
})
export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>

export const presignUploadResponseSchema = z.object({
  uploadUrl: z.string(),
  /** Send these exact headers with the PUT — they are part of the signature. */
  headers: z.record(z.string(), z.string()),
  thumbnail: z
    .object({ uploadUrl: z.string(), headers: z.record(z.string(), z.string()) })
    .nullable(),
  /** Opaque, signed; hand it back to /commit unchanged. */
  ticket: z.string(),
  expiresIn: z.number(),
})
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>

export const commitUploadRequestSchema = z.object({
  ticket: z.string().min(1),
  name: z.string().min(1).max(255),
  thumbnailUploaded: z.boolean().default(false),
})
export type CommitUploadRequest = z.infer<typeof commitUploadRequestSchema>

export const createLinkRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  name: z.string().min(1).max(255).optional(),
})
export type CreateLinkRequest = z.infer<typeof createLinkRequestSchema>

export const listMediaQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  type: mediaTypeSchema.optional(),
  search: z.string().max(100).optional(),
})
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>
