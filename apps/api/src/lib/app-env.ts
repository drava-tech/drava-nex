import type { SessionUser } from "./auth"

/** Hono context variables set by middleware. */
export type AppEnv = {
  Variables: {
    user: SessionUser
  }
}
