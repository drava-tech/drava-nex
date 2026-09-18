import { createDb } from "@workspace/db"

import { env } from "../env"

export const { db, pool } = createDb(env.DATABASE_URL)
