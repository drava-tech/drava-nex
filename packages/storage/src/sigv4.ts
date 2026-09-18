import { createHash, createHmac } from "node:crypto"

/**
 * A minimal AWS Signature Version 4 query-string presigner (the "presigned
 * URL" flavour), for S3-compatible storage such as Cloudflare R2.
 *
 * Deliberately not @aws-sdk/*: that is tens of megabytes of dependency to
 * produce a URL that is a few dozen lines of crypto. Correctness is pinned by
 * test/sigv4.test.ts, which compares every output byte-for-byte with AWS's own
 * signer (@smithy/signature-v4) under a frozen clock.
 *
 * Ported from cms-platform's flight-video.ts and generalised to any method.
 * Two of that file's lessons are handled structurally here rather than by
 * convention:
 *  - Query values are RFC 3986-encoded, not URLSearchParams-encoded, so a
 *    space becomes %20 (not +) and !'()* are escaped — the old "never put a
 *    space in a signed value" rule no longer applies.
 *  - The HTTP method is part of the signature, so a URL signed for GET is
 *    rejected for HEAD (SignatureDoesNotMatch). Existence checks must use a
 *    ranged GET; see objectExists().
 */

const sha256hex = (value: string) => createHash("sha256").update(value).digest("hex")
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest()

/** RFC 3986 percent-encoding, as SigV4 requires (stricter than encodeURIComponent). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/** `/a b/c` → `/a%20b/c` — each segment encoded, slashes kept. */
export function encodePath(path: string): string {
  return path.split("/").map(rfc3986).join("/")
}

/** `20240102T030405Z` */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "")
}

export type PresignInput = {
  method: "GET" | "PUT" | "DELETE" | "HEAD"
  /** Host only, e.g. `acc.r2.cloudflarestorage.com` (a port is allowed). */
  host: string
  /** Absolute path, NOT yet encoded, e.g. `/bucket/media/a.mp4`. */
  path: string
  region: string
  service?: string
  accessKeyId: string
  secretAccessKey: string
  expiresInSeconds: number
  /** Extra query parameters to sign (e.g. response-cache-control). */
  query?: Record<string, string>
  /**
   * Headers the client MUST send with exactly these values (e.g. content-type
   * on a PUT). They are signed, so any difference fails the request.
   */
  headers?: Record<string, string>
  now?: Date
}

export function presignUrl(input: PresignInput): string {
  const now = input.now ?? new Date()
  const service = input.service ?? "s3"
  const datetime = amzDate(now)
  const date = datetime.slice(0, 8)
  const scope = `${date}/${input.region}/${service}/aws4_request`

  // Canonical headers: lowercase names, trimmed values, sorted by name. `host`
  // is always signed.
  const headers = new Map<string, string>([["host", input.host]])
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "))
  }
  const headerNames = [...headers.keys()].sort()
  const signedHeaders = headerNames.join(";")
  // Every header line ends in "\n"; joining the request parts with "\n" below
  // then adds the blank line SigV4 requires before the signed-headers list.
  const canonicalHeaders = headerNames.map((n) => `${n}:${headers.get(n)}\n`).join("")

  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.accessKeyId}/${scope}`],
    ["X-Amz-Date", datetime],
    ["X-Amz-Expires", String(input.expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
    ...Object.entries(input.query ?? {}),
  ]
  // Sorted by encoded name (then value), as the spec requires.
  const canonicalQuery = params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")

  const canonicalPath = encodePath(input.path)
  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n")

  const stringToSign = ["AWS4-HMAC-SHA256", datetime, scope, sha256hex(canonicalRequest)].join("\n")

  const kDate = hmac(`AWS4${input.secretAccessKey}`, date)
  const kRegion = hmac(kDate, input.region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, "aws4_request")
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex")

  return `https://${input.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
