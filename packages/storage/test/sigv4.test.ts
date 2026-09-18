import { Sha256 } from "@aws-crypto/sha256-js"
import { HttpRequest } from "@smithy/protocol-http"
import { SignatureV4 } from "@smithy/signature-v4"
import { describe, expect, it } from "vitest"

import {
  buildObjectKey,
  encodePath,
  isSafeObjectKey,
  presignDelete,
  presignGet,
  presignPut,
  presignUrl,
  publicObjectUrl,
  thumbnailKeyFor,
  type StorageConfig,
} from "../src"

/**
 * Oracle: AWS's own SigV4 implementation (the one inside the official SDK).
 * Every URL our zero-dependency signer produces must carry exactly the query
 * parameters and signature it produces for the same request and instant.
 */
const creds = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" }
const NOW = new Date("2026-09-18T08:30:00.000Z")

async function oracle(opts: {
  method: string
  host: string
  path: string
  region: string
  expiresIn: number
  query?: Record<string, string>
  headers?: Record<string, string>
}): Promise<Record<string, string>> {
  const signer = new SignatureV4({
    credentials: creds,
    region: opts.region,
    service: "s3",
    sha256: Sha256,
    // S3 paths are escaped exactly once; the request below carries it escaped.
    uriEscapePath: false,
  })
  const request = new HttpRequest({
    method: opts.method,
    protocol: "https:",
    hostname: opts.host,
    path: encodePath(opts.path),
    query: { ...(opts.query ?? {}) },
    headers: {
      host: opts.host,
      ...(opts.headers ?? {}),
      // As @aws-sdk/s3-request-presigner does: sign UNSIGNED-PAYLOAD without
      // putting this header in the URL or in SignedHeaders.
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
  })
  const skip = new Set(["x-amz-content-sha256"])
  const signed = await signer.presign(request, {
    expiresIn: opts.expiresIn,
    signingDate: NOW,
    unhoistableHeaders: skip,
    unsignableHeaders: skip,
  })
  return Object.fromEntries(
    Object.entries(signed.query ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)])
  )
}

function paramsOf(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries())
}

describe("presignUrl matches AWS's signer", () => {
  const cases = [
    { name: "GET", method: "GET" as const, path: "/bucket/media/a/b.mp4", region: "auto", expiresIn: 3600 },
    { name: "GET, us-east-1", method: "GET" as const, path: "/b/test.txt", region: "us-east-1", expiresIn: 86400 },
    {
      name: "GET with a signed response override containing a space and a comma",
      method: "GET" as const,
      path: "/bucket/x.png",
      region: "auto",
      expiresIn: 600,
      query: { "response-cache-control": "public, max-age=3600" },
    },
    {
      name: "PUT with a signed content-type",
      method: "PUT" as const,
      path: "/bucket/media/u1/u2.mp4",
      region: "auto",
      expiresIn: 900,
      headers: { "Content-Type": "video/mp4" },
    },
    { name: "DELETE", method: "DELETE" as const, path: "/bucket/media/u1/u2.mp4", region: "auto", expiresIn: 60 },
    {
      name: "path needing escapes (space, parens, unicode)",
      method: "GET" as const,
      path: "/bucket/odd name (1)/café.pdf",
      region: "auto",
      expiresIn: 60,
    },
  ]

  for (const c of cases) {
    it(c.name, async () => {
      const host = "acc123.r2.cloudflarestorage.com"
      const ours = presignUrl({
        method: c.method,
        host,
        path: c.path,
        region: c.region,
        ...creds,
        expiresInSeconds: c.expiresIn,
        ...(c.query ? { query: c.query } : {}),
        ...(c.headers ? { headers: c.headers } : {}),
        now: NOW,
      })
      const theirs = await oracle({
        method: c.method,
        host,
        path: c.path,
        region: c.region,
        expiresIn: c.expiresIn,
        ...(c.query ? { query: c.query } : {}),
        ...(c.headers ? { headers: c.headers } : {}),
      })
      expect(paramsOf(ours)).toEqual(theirs)
      expect(new URL(ours).pathname).toBe(encodePath(c.path))
      // Spaces must be %20 on the wire, never "+".
      expect(ours).not.toMatch(/\+/)
    })
  }
})

describe("storage helpers", () => {
  const config: StorageConfig = {
    ...creds,
    bucket: "push-media",
    endpoint: "https://acc123.r2.cloudflarestorage.com/push-media",
    region: "auto",
  }

  it("uses path-style addressing and tolerates a bucket suffix on the endpoint", () => {
    const url = new URL(presignGet(config, "media/a/b.mp4", { now: NOW }))
    expect(url.host).toBe("acc123.r2.cloudflarestorage.com")
    expect(url.pathname).toBe("/push-media/media/a/b.mp4")
  })

  it("keeps http for a local MinIO endpoint", () => {
    const local = { ...config, endpoint: "http://localhost:9100", region: "us-east-1" }
    expect(presignGet(local, "media/a.png", { now: NOW })).toMatch(/^http:\/\/localhost:9100\/push-media\//)
  })

  it("returns the exact headers the uploader must send", () => {
    const put = presignPut(config, "media/a/b.mp4", {
      contentType: "video/mp4",
      cacheControl: "public, max-age=31536000, immutable",
      now: NOW,
    })
    expect(put.headers).toEqual({
      "Content-Type": "video/mp4",
      "Cache-Control": "public, max-age=31536000, immutable",
    })
    // Cache-Control is sent but not signed — AWS's signer refuses to sign it
    // too, because intermediaries may rewrite it.
    expect(new URL(put.url).searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host")
  })

  it("matches AWS's signer for the PUT we actually issue", async () => {
    const put = presignPut(config, "media/a/b.mp4", {
      contentType: "video/mp4",
      cacheControl: "public, max-age=31536000, immutable",
      now: NOW,
    })
    const theirs = await oracle({
      method: "PUT",
      host: "acc123.r2.cloudflarestorage.com",
      path: "/push-media/media/a/b.mp4",
      region: "auto",
      expiresIn: 900,
      headers: put.headers,
    })
    expect(paramsOf(put.url)).toEqual(theirs)
  })

  it("signs DELETE with the method bound in", () => {
    const del = presignDelete(config, "media/a/b.mp4")
    const get = presignGet(config, "media/a/b.mp4", { expiresInSeconds: 60 })
    expect(new URL(del).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(get).searchParams.get("X-Amz-Signature")
    )
  })

  it("refuses to sign unsafe keys", () => {
    for (const bad of ["../etc/passwd", "media//x", "/abs", "a b.mp4", "media/x?y=1", ""]) {
      expect(isSafeObjectKey(bad), bad).toBe(false)
      expect(() => presignGet(config, bad)).toThrow(/unsafe object key/)
    }
  })

  it("builds two-uuid keys that are always safe", () => {
    for (const ext of [".mp4", "PNG", ".tar.gz", "", ".we!rd"]) {
      const key = buildObjectKey(ext)
      expect(isSafeObjectKey(key), key).toBe(true)
      expect(key).toMatch(/^media\/[0-9a-f-]{36}\/[0-9a-f-]{36}/)
    }
    expect(buildObjectKey(".mp4")).not.toBe(buildObjectKey(".mp4"))
  })

  it("derives thumbnail keys next to the original", () => {
    expect(thumbnailKeyFor("media/a/b.mp4")).toBe("media/a/b.thumb.webp")
    expect(thumbnailKeyFor("media/a/b")).toBe("media/a/b.thumb.webp")
  })

  it("builds public URLs only when a public domain is configured", () => {
    expect(publicObjectUrl(config, "media/a/b.png")).toBeNull()
    expect(publicObjectUrl({ ...config, publicBaseUrl: "https://media.example.com/" }, "media/a/b.png")).toBe(
      "https://media.example.com/media/a/b.png"
    )
  })
})
