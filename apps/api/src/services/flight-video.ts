import { createHash, createHmac } from "node:crypto";

/**
 * Presigned access to the Flight Garden's video renders in Cloudflare R2.
 *
 * The renders are ~1 GB of 4K video each: far too large for the repo or the
 * deploy bundle, so they live in a private R2 bucket and the browser is handed
 * a short-lived signed URL instead. That keeps the bucket private and the R2
 * credentials server-side, the same division of labour the rest of this API
 * uses for provider keys.
 *
 * Ported from the standalone project's api/_r2.js. A minimal SigV4 query
 * signer rather than @aws-sdk/*: the SDK is ~20 MB of dependency to produce a
 * URL that is forty lines of crypto.
 */

const sha256hex = (value: string): string => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac("sha256", key).update(value).digest();

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
}

/**
 * Reads the R2 settings from the environment, or returns null when the bucket
 * is not configured. Null is a normal state, not an error: a deployment with no
 * R2 bucket still serves every other part of this template, and the renderer
 * falls back to the committed still image.
 */
export function readR2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accessKeyId = env["FLIGHT_R2_ACCESS_KEY_ID"];
  const secretAccessKey = env["FLIGHT_R2_SECRET_ACCESS_KEY"];
  const bucket = env["FLIGHT_R2_BUCKET"];
  const endpoint = env["FLIGHT_R2_ENDPOINT"];

  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) return null;

  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region: env["FLIGHT_R2_REGION"] ?? "auto",
  };
}

/**
 * Presigns a GET for one object and returns a plain HTTPS URL that anyone
 * holding it can read until it expires — which is the point: it lets the
 * browser stream straight from R2 without the bucket ever being public.
 *
 * Range requests work against the returned URL (the browser needs 206s to seek
 * and to stream a large file), and R2 applies the bucket's CORS policy to it,
 * so the display's origin must be allowed there — otherwise the WebGL texture
 * upload in flight-garden.js taints the canvas and throws.
 */
export function presignR2Get(config: R2Config, key: string, expiresInSeconds = 6 * 60 * 60): string {
  // The endpoint carries the bucket as a path suffix; only its host is wanted
  // here, because the canonical path below is built as /<bucket>/<key>.
  const host = new URL(config.endpoint).host;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;

  const canonicalPath = `/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
    // S3's response-header override forces this GET's response to carry a real
    // Cache-Control regardless of what is stored on the object, so the browser
    // can reuse a scene's video from its HTTP cache on a later switch back.
    //
    // No space after the comma: URLSearchParams encodes spaces as "+", but
    // SigV4's canonical query string requires strict %20 — the mismatch between
    // what gets signed and what R2 re-derives fails as SignatureDoesNotMatch.
    // Comma-separated with no space is still valid HTTP header syntax, so this
    // sidesteps the encoding gap entirely.
    "response-cache-control": "public,max-age=3600",
  });
  params.sort(); // SigV4 requires the canonical query sorted by parameter name
  const canonicalQuery = params.toString();

  const canonicalRequest = [
    "GET",
    canonicalPath,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  let signingKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  signingKey = hmac(signingKey, config.region);
  signingKey = hmac(signingKey, "s3");
  signingKey = hmac(signingKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Every video the template is allowed to stream, keyed by the short id the
 * browser asks for (GET /api/flight-simulation/garden-video?id=<id>).
 *
 * This is an allowlist, not a lookup convenience. The endpoint signs whatever
 * key it is handed, so accepting an arbitrary key straight off the query string
 * would let anyone holding the URL mint a signed link to *any* object in the
 * bucket. Ids come in, keys go out — never the other way round.
 *
 * The browser-side half of this table is VIDEO_PATHS in flight-garden.js; the
 * ids must match. This file is the security boundary.
 */
const VIDEO_KEYS: Record<string, string> = {
  "flight-garden": "flight-simulation/4k_render_final_001.mp4",
  "weather-warm": "flight-simulation/weather_warm.mp4",
};

const DEFAULT_VIDEO_ID = "flight-garden";

/** Resolves a request's `?id=` to an R2 key, or null if it is not allowlisted. */
export function resolveVideoKey(id: string | undefined): string | null {
  if (!id) return VIDEO_KEYS[DEFAULT_VIDEO_ID] ?? null;
  return Object.prototype.hasOwnProperty.call(VIDEO_KEYS, id) ? (VIDEO_KEYS[id] ?? null) : null;
}
