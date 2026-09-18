import { useCallback, useEffect, useState } from "react"
import { IDLE_CONTENT, type ScreenCommand, type ScreenContent } from "@workspace/types"

import { deviceFetch } from "@/lib/device"
import { MUTE_EVENT } from "./player/renderers"
import { ScreenPlayer } from "./player/screen-player"
import { useScreenSocket } from "./player/use-screen-socket"

type Props = { screenId: string; name: string; token: string; onRevoked: () => void }

/** How often a display re-asks over HTTP while its socket is down. */
const FALLBACK_POLL_MS = 15_000

/**
 * A paired display: the gateway decides what to show, ScreenPlayer shows it.
 */
export function LiveDisplay({ screenId, name, token, onRevoked }: Props) {
  const [content, setContent] = useState<ScreenContent>(IDLE_CONTENT)
  const [blanked, setBlanked] = useState(false)

  const onCommand = useCallback((command: ScreenCommand) => {
    switch (command) {
      case "RELOAD":
        window.location.reload()
        break
      case "SCREEN_BLANK":
        setBlanked(true)
        break
      case "SCREEN_UNBLANK":
        setBlanked(false)
        break
      case "MUTE":
      case "UNMUTE":
        window.dispatchEvent(new CustomEvent(MUTE_EVENT, { detail: { muted: command === "MUTE" } }))
        break
    }
  }, [])

  const status = useScreenSocket({
    screenId,
    token,
    onContent: setContent,
    onWelcome: (c, b) => {
      setContent(c)
      setBlanked(b)
    },
    onCommand,
    onRevoked,
  })

  // Some networks let HTTP through but break WebSockets. While the socket is
  // down, keep the screen roughly current over plain HTTP.
  useEffect(() => {
    if (status === "connected") return
    const poll = async () => {
      try {
        const res = await deviceFetch("/api/device/content", token)
        if (res.status === 401) return onRevoked()
        const body = (await res.json()) as { success: boolean; data?: { content: ScreenContent; blanked: boolean } }
        if (body.success && body.data) {
          setContent(body.data.content)
          setBlanked(body.data.blanked)
        }
      } catch {
        // offline; try again next tick
      }
    }
    const id = setInterval(() => void poll(), FALLBACK_POLL_MS)
    return () => clearInterval(id)
  }, [status, token, onRevoked])

  return (
    <div data-socket-status={status} className="cursor-none">
      <ScreenPlayer content={content} blanked={blanked} name={name} />
    </div>
  )
}
