import { pairingRepo } from "@workspace/db"

import { db } from "../lib/db"

export const pairing = pairingRepo(db)

/** How long a code shown in the console stays valid. */
export const PAIRING_CODE_TTL_MS = 10 * 60_000
