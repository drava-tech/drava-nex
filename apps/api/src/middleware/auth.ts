import { createMiddleware } from "hono/factory"
import type { Role } from "@workspace/types"

import type { AppEnv } from "../lib/app-env"
import { auth } from "../lib/auth"
import { fail } from "../lib/response"

/**
 * Guards a route to signed-in users holding one of `roles` (any role when none
 * are given). The console's route guards are UX only — this is the actual
 * enforcement.
 */
export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return fail(c, "UNAUTHORIZED", "Sign in required", 401)
    if (roles.length > 0 && !roles.includes(session.user.role as Role)) {
      return fail(c, "FORBIDDEN", "Your role does not allow this", 403)
    }
    c.set("user", session.user)
    await next()
  })
}

/** Anyone signed in may read. */
export const requireUser = requireRole()
/** Pushing content and controlling screens. */
export const requireOperator = requireRole("ADMIN", "OPERATOR")
/** Managing screens, media and users. */
export const requireAdmin = requireRole("ADMIN")
