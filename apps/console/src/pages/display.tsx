import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { RouteFallback } from "@/components/route-fallback"
import { LiveDisplay } from "@/features/display/live-display"
import { PairForm } from "@/features/display/pair-form"
import { deviceFetch, forgetDevice, readDevice } from "@/lib/device"

type State =
  | { kind: "checking" }
  | { kind: "unpaired"; notice?: string }
  | { kind: "paired"; screenId: string; name: string; token: string }

/**
 * /display and /display/:screenId. Public — a display has no user session.
 *
 * Bare /display is where a new display starts: it pairs, learns which screen it
 * is from the answer, and moves to /display/<id>. A display whose token was
 * revoked (unpaired, re-paired elsewhere, screen deleted) falls back here.
 */
export function DisplayPage() {
  const { screenId } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: "checking" })

  useEffect(() => {
    let cancelled = false
    const creds = readDevice()
    if (!creds) {
      setState({ kind: "unpaired" })
      return
    }
    if (screenId && creds.screenId !== screenId) {
      // This browser is paired with a different screen than the URL names.
      setState({ kind: "unpaired", notice: "This display is paired with another screen. Pair it again to switch." })
      return
    }
    deviceFetch("/api/device/me", creds.token)
      .then((res) => {
        if (cancelled) return
        if (res.status === 401) {
          forgetDevice()
          setState({ kind: "unpaired", notice: "This display was unpaired. Type a new code to pair it again." })
        } else {
          // A network error or 5xx keeps the stored identity: the server is
          // unreachable, not saying no.
          setState({ kind: "paired", ...creds })
          if (!screenId) navigate(`/display/${creds.screenId}`, { replace: true })
        }
      })
      .catch(() => !cancelled && setState({ kind: "paired", ...creds }))
    return () => {
      cancelled = true
    }
  }, [screenId, navigate])

  if (state.kind === "checking") return <RouteFallback />
  if (state.kind === "unpaired") {
    return (
      <PairForm
        {...(state.notice ? { notice: state.notice } : {})}
        onPaired={(p) => {
          setState({ kind: "paired", ...p })
          navigate(`/display/${p.screenId}`, { replace: true })
        }}
      />
    )
  }

  return (
    <LiveDisplay
      screenId={state.screenId}
      name={state.name}
      token={state.token}
      onRevoked={() => {
        forgetDevice()
        setState({ kind: "unpaired", notice: "This display was unpaired. Type a new code to pair it again." })
        navigate("/display", { replace: true })
      }}
    />
  )
}
