import { redirect, type LoaderFunctionArgs } from "react-router"

import { authClient, type SessionUser } from "@/lib/auth-client"

async function currentUser(): Promise<SessionUser | null> {
  const { data } = await authClient.getSession()
  return data?.user ?? null
}

/**
 * Loader for everything behind the dashboard. Runs before any protected page
 * renders, so there is no flash of admin UI for a signed-out visitor.
 *
 * This is UX only — the API enforces every route on its own.
 */
export async function requireSessionLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUser()
  if (!user) {
    const { pathname, search } = new URL(request.url)
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`
    throw redirect(`/login${next}`)
  }
  return { user }
}

/** Loader for /login: an already signed-in visitor goes straight in. */
export async function redirectIfSignedInLoader() {
  if (await currentUser()) throw redirect("/")
  return null
}

/** Only follow same-app paths after login — never an absolute URL. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
}
