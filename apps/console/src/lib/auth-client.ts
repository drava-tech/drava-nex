import { inferAdditionalFields } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/**
 * The API is always same-origin (Vite proxy in dev, nginx in production), so
 * the client talks to the page's own origin and cookies need no CORS.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [
    inferAdditionalFields({
      user: { role: { type: "string", required: true, input: false } },
    }),
  ],
})

export type SessionUser = typeof authClient.$Infer.Session.user
