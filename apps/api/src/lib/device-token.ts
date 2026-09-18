import { createHash, randomBytes, randomInt } from "node:crypto"
import { PAIRING_ALPHABET, PAIRING_CODE_LENGTH } from "@workspace/types"

/** 256 bits of randomness, url-safe. Handed to the device once, never stored. */
export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Only this hash is stored. Looking a screen up by it through a unique index
 * is safe: the hash is not the secret, and sha256 is not reversible.
 */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** 6 characters from a 30-symbol alphabet with no look-alikes (~7×10⁸ codes). */
export function newPairingCode(): string {
  let code = ""
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]
  return code
}

/** `Authorization: Bearer <token>` → token, or null. */
export function bearerToken(header: string | undefined | null): string | null {
  const match = header?.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/)
  return match?.[1] ?? null
}
