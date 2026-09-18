/**
 * Real round trip against S3-compatible storage (local MinIO in dev, or an R2
 * bucket). Skipped unless R2_* is configured — run with:
 *
 *   pnpm services:up && pnpm --filter @workspace/storage test
 */
import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  buildObjectKey,
  deleteObject,
  objectExists,
  presignGet,
  presignPut,
  readStorageConfig,
} from "../src"

const rootEnv = new URL("../../../.env", import.meta.url)
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)
const config = readStorageConfig()

describe.skipIf(!config)("storage round trip", () => {
  const cfg = config!
  const key = buildObjectKey(".mp4")
  const body = new Uint8Array(4096).map((_, i) => i % 251)

  it("uploads with a presigned PUT carrying exactly the returned headers", async () => {
    const put = presignPut(cfg, key, {
      contentType: "video/mp4",
      cacheControl: "public, max-age=31536000, immutable",
    })
    const res = await fetch(put.url, { method: "PUT", headers: put.headers, body })
    expect(res.status, await res.text()).toBe(200)
  })

  it("rejects a PUT whose Content-Type differs from the signed one", async () => {
    const put = presignPut(cfg, buildObjectKey(".mp4"), { contentType: "video/mp4" })
    const res = await fetch(put.url, {
      method: "PUT",
      headers: { "Content-Type": "text/html" },
      body: "<script>alert(1)</script>",
    })
    await res.arrayBuffer()
    expect(res.status).toBe(403)
  })

  it("sees the object via a ranged GET", async () => {
    expect(await objectExists(cfg, key)).toBe(true)
  })

  it("serves byte ranges (a <video> needs 206 to seek)", async () => {
    const res = await fetch(presignGet(cfg, key), { headers: { Range: "bytes=100-199" } })
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(res.status).toBe(206)
    expect(res.headers.get("content-range")).toBe("bytes 100-199/4096")
    expect(res.headers.get("content-type")).toBe("video/mp4")
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(Array.from(bytes)).toEqual(Array.from(body.slice(100, 200)))
  })

  it("refuses HEAD against a GET presign (the method is signed)", async () => {
    const res = await fetch(presignGet(cfg, key), { method: "HEAD" })
    expect(res.status).toBe(403)
  })

  it("deletes, and then reports the object missing", async () => {
    await deleteObject(cfg, key)
    expect(await objectExists(cfg, key)).toBe(false)
    // Deleting again is not an error.
    await deleteObject(cfg, key)
  })
})
