import { randomUUID } from "node:crypto"

/**
 * Object keys are generated here and nowhere else, from a deliberately tiny
 * alphabet. Restricting keys at the source removes a whole class of encoding
 * bugs (and path tricks) instead of trying to escape them correctly later.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/

export function isSafeObjectKey(key: string): boolean {
  return SAFE_KEY.test(key) && !key.includes("..") && !key.includes("//") && key.length <= 512
}

/**
 * `media/<uuid>/<uuid>.<ext>` — two independent uuids, so on a public bucket
 * knowing one object's URL tells you nothing about any other.
 */
export function buildObjectKey(ext: string): string {
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, "")
  const suffix = cleanExt.startsWith(".") ? cleanExt : cleanExt ? `.${cleanExt}` : ""
  return `media/${randomUUID()}/${randomUUID()}${suffix}`
}

/** The thumbnail tile that sits next to an object: `<key-without-ext>.thumb.webp`. */
export function thumbnailKeyFor(key: string): string {
  return key.replace(/\.[^./]+$/, "") + ".thumb.webp"
}
