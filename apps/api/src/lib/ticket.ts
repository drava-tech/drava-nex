import { createHmac, timingSafeEqual } from "node:crypto"
import type { UploadableType } from "@workspace/types"

import { env } from "../env"

/**
 * What the server decided at presign time. The browser carries it to /commit
 * but cannot change it: the ticket is HMAC-signed, and /commit trusts only the
 * ticket — never a key, type or size sent alongside it. Otherwise an admin's
 * browser could commit a row pointing at any object in the bucket.
 */
export type UploadTicket = {
  id: string
  key: string
  thumbKey: string | null
  type: UploadableType
  contentType: string
  sizeBytes: number
  /** Unix seconds. */
  exp: number
}

function sign(payload: string): string {
  return createHmac("sha256", env.UPLOAD_TICKET_SECRET).update(payload).digest("base64url")
}

export function issueTicket(ticket: UploadTicket): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url")
  return `${payload}.${sign(payload)}`
}

export function verifyTicket(token: string): UploadTicket | null {
  const [payload, mac] = token.split(".")
  if (!payload || !mac) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString()) as UploadTicket
    return ticket.exp * 1000 > Date.now() ? ticket : null
  } catch {
    return null
  }
}
