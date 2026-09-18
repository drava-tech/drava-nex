/** The gateway's WebSocket URL on this page's own origin (ws:// or wss://). */
export function wsUrl(path = "/ws"): string {
  const { protocol, host } = window.location
  return `${protocol === "https:" ? "wss" : "ws"}://${host}${path}`
}
