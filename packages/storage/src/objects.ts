import { endpointParts, type StorageConfig } from "./config"
import { isSafeObjectKey } from "./keys"
import { presignUrl, type PresignInput } from "./sigv4"

function assertKey(key: string) {
  if (!isSafeObjectKey(key)) throw new Error(`Refusing to sign unsafe object key: ${key}`)
}

function base(config: StorageConfig, key: string): Omit<PresignInput, "method" | "expiresInSeconds"> {
  assertKey(key)
  const { host } = endpointParts(config)
  return {
    host,
    path: `/${config.bucket}/${key}`,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  }
}

/** presignUrl always emits https; keep a local MinIO's http:// working. */
function withScheme(config: StorageConfig, url: string): string {
  return new URL(config.endpoint).protocol === "http:" ? url.replace(/^https:/, "http:") : url
}

export function presignGet(
  config: StorageConfig,
  key: string,
  opts: { expiresInSeconds?: number; responseCacheControl?: string; now?: Date } = {}
): string {
  return withScheme(
    config,
    presignUrl({
      ...base(config, key),
      method: "GET",
      expiresInSeconds: opts.expiresInSeconds ?? 3600,
      ...(opts.responseCacheControl
        ? { query: { "response-cache-control": opts.responseCacheControl } }
        : {}),
      ...(opts.now ? { now: opts.now } : {}),
    })
  )
}

/**
 * Presigned PUT. The uploader sends back exactly the returned `headers`.
 *
 * Only Content-Type is signed — a wrong type would make a video unplayable, so
 * it must not be changeable. Cache-Control is sent (storage keeps it as object
 * metadata) but deliberately NOT signed, matching AWS's own signer, which
 * refuses to sign it: browsers and proxies may rewrite that header, and a
 * signed value would then fail as SignatureDoesNotMatch. (It still has to be
 * listed in the bucket CORS AllowedHeaders, because the browser sends it.)
 *
 * A query-string presign cannot bind Content-Length, so this does NOT cap the
 * upload size — only who can mint the URL (admins) and for how long.
 */
export function presignPut(
  config: StorageConfig,
  key: string,
  opts: { contentType: string; cacheControl?: string; expiresInSeconds?: number; now?: Date }
): { url: string; headers: Record<string, string> } {
  const signed = { "Content-Type": opts.contentType }
  const url = presignUrl({
    ...base(config, key),
    method: "PUT",
    expiresInSeconds: opts.expiresInSeconds ?? 900,
    headers: signed,
    ...(opts.now ? { now: opts.now } : {}),
  })
  return {
    url: withScheme(config, url),
    headers: { ...signed, ...(opts.cacheControl ? { "Cache-Control": opts.cacheControl } : {}) },
  }
}

export function presignDelete(config: StorageConfig, key: string, expiresInSeconds = 60): string {
  return withScheme(config, presignUrl({ ...base(config, key), method: "DELETE", expiresInSeconds }))
}

/**
 * Whether an object exists. A one-byte ranged GET — never HEAD, because the
 * signature binds the method and a HEAD against a GET presign always fails.
 * Network failures throw: "couldn't ask" is not the same answer as "missing".
 */
export async function objectExists(config: StorageConfig, key: string): Promise<boolean> {
  const res = await fetch(presignGet(config, key, { expiresInSeconds: 60 }), {
    headers: { Range: "bytes=0-0" },
  })
  // Drain the (one-byte) body so the socket goes back to the pool.
  await res.arrayBuffer().catch(() => undefined)
  if (res.ok) return true // 206, or 200 if ranges are ignored
  if (res.status === 404) return false
  throw new Error(`Storage answered ${res.status} checking ${key}`)
}

/** Deletes an object. Already-gone counts as success. */
export async function deleteObject(config: StorageConfig, key: string): Promise<void> {
  const res = await fetch(presignDelete(config, key), { method: "DELETE" })
  await res.arrayBuffer().catch(() => undefined)
  if (!res.ok && res.status !== 404) {
    throw new Error(`Storage answered ${res.status} deleting ${key}`)
  }
}

/** Public URL on the bucket's custom domain, or null when none is configured. */
export function publicObjectUrl(config: StorageConfig, key: string): string | null {
  if (!config.publicBaseUrl) return null
  assertKey(key)
  return `${config.publicBaseUrl.replace(/\/+$/, "")}/${key}`
}
