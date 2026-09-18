export type StorageConfig = {
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** e.g. https://<account>.r2.cloudflarestorage.com (a trailing /bucket is tolerated). */
  endpoint: string
  region: string
  /** Public custom domain bound to the bucket; unset = serve via presigned redirects. */
  publicBaseUrl?: string
}

type EnvLike = Record<string, string | undefined>

/**
 * Reads the R2_* variables. Returns null when storage is not configured — a
 * normal state in early development, which callers turn into a clear 503
 * rather than a crash.
 */
export function readStorageConfig(env: EnvLike = process.env): StorageConfig | null {
  const accessKeyId = env["R2_ACCESS_KEY_ID"]
  const secretAccessKey = env["R2_SECRET_ACCESS_KEY"]
  const bucket = env["R2_BUCKET"]
  const endpoint = env["R2_ENDPOINT"]
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) return null
  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region: env["R2_REGION"] || "auto",
    publicBaseUrl: env["R2_PUBLIC_BASE_URL"] || undefined,
  }
}

/**
 * Where requests go. Path-style addressing (`/<bucket>/<key>`) works on R2,
 * MinIO and S3 alike. An endpoint pasted with the bucket already appended is
 * tolerated, and an http:// endpoint (a local MinIO) keeps its scheme.
 */
export function endpointParts(config: StorageConfig): { origin: string; host: string } {
  const url = new URL(config.endpoint)
  return { origin: `${url.protocol}//${url.host}`, host: url.host }
}
