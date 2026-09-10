/**
 * postMessage bridge between the display page and a viewer it frames
 * (`/display/pdf`, and any future framed viewer that needs remote control).
 *
 * Why it exists: the display page owns the one WebSocket to the gateway, but
 * a viewer runs inside an iframe — a separate JS realm. Outbound is already
 * solved (the child dispatches a `screen-control` CustomEvent on
 * window.parent, which LiveScreenPlayer already relays); inbound had no path
 * at all, which is why SlidesViewer used to receive none of the NEXT_PAGE/
 * PREV_PAGE commands that had existed for ages. This closes that direction,
 * and both PdfViewer and SlidesViewer now connect through it.
 *
 * postMessage rather than reaching across with window.parent.dispatchEvent:
 * one channel with one origin check, and it keeps working if these viewers
 * ever move to a different origin.
 */

/** Discriminator on every message. Required, not defensive — the YouTube
 * IFrame API posts its own traffic to this same window. */
export const FRAME_BRIDGE_SOURCE = "cms-display-frame";

/**
 * Commands the display page mirrors into a framed viewer. Anything not
 * listed here stays parent-only, so adding a viewer command is a
 * one-line, explicitly-reviewed change rather than a blanket forward.
 *
 * A `SET_`-prefixed command is additionally remembered by the gateway
 * per-content and replayed when that content is pushed again — see
 * viewStateCache in apps/api/src/ws/gateway.ts. That is what makes a PDF
 * resume on the page it was left at.
 */
export const FRAME_FORWARDED_COMMANDS = [
  "NEXT_PAGE",
  "PREV_PAGE",
  "ZOOM_IN",
  "ZOOM_OUT",
  "SET_PDF_VIEW",
  "SET_SLIDES_VIEW",
  "SET_WORD_VIEW",
  "RESET_STATE",
  "RESET_VIEW",
] as const;

export type FrameForwardedCommand = (typeof FRAME_FORWARDED_COMMANDS)[number];

export function isFrameForwardedCommand(command: string): boolean {
  return (FRAME_FORWARDED_COMMANDS as readonly string[]).includes(command);
}

/** Window-event name the display page republishes a forwarded command under,
 * so HtmlRenderer can pick it up without knowing about the WS. */
export function frameCommandEvent(command: string): string {
  return `frame-command:${command}`;
}

export type FrameBridgeMessage =
  /** child → parent, once the viewer is listening */
  | { source: typeof FRAME_BRIDGE_SOURCE; kind: "ready" }
  /** parent → child, answering "ready" */
  | { source: typeof FRAME_BRIDGE_SOURCE; kind: "init"; preview: boolean }
  /** parent → child, a remote command */
  | { source: typeof FRAME_BRIDGE_SOURCE; kind: "command"; command: string; value?: unknown }
  /** child → parent, an interaction to relay to every client of this screen */
  | { source: typeof FRAME_BRIDGE_SOURCE; kind: "control"; command: string; value?: unknown };

function isBridgeMessage(data: unknown): data is FrameBridgeMessage {
  return typeof data === "object" && data !== null &&
    (data as { source?: unknown }).source === FRAME_BRIDGE_SOURCE;
}

export interface FrameBridge {
  /** Relay an interaction to every client of this screen (and the gateway). */
  send(command: string, value?: unknown): void;
  disconnect(): void;
}

/**
 * Child (viewer) side. Announces readiness, then applies inbound commands.
 *
 * `preview` arrives via the init ACK and matters: the CMS mirror and the real
 * TV both render the same viewer, and only the authoritative (non-preview)
 * one may answer a delta command with an absolute SET_* — otherwise a single
 * remote navigation gets answered twice.
 *
 * Returns a no-op sender when there is no parent frame, so opening a viewer
 * URL directly in a tab still works.
 */
export function connectFrameBridge(opts: {
  onCommand: (command: string, value: unknown) => void;
  onInit?: (init: { preview: boolean }) => void;
}): FrameBridge {
  if (typeof window === "undefined" || window.parent === window) {
    return { send: () => {}, disconnect: () => {} };
  }

  const parent = window.parent;
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.source !== parent) return;
    if (!isBridgeMessage(e.data)) return;
    if (e.data.kind === "command") opts.onCommand(e.data.command, e.data.value);
    else if (e.data.kind === "init") opts.onInit?.({ preview: e.data.preview });
  };

  window.addEventListener("message", onMessage);
  const ready: FrameBridgeMessage = { source: FRAME_BRIDGE_SOURCE, kind: "ready" };
  parent.postMessage(ready, window.location.origin);

  return {
    send(command, value) {
      const msg: FrameBridgeMessage = { source: FRAME_BRIDGE_SOURCE, kind: "control", command, value };
      parent.postMessage(msg, window.location.origin);
    },
    disconnect() {
      window.removeEventListener("message", onMessage);
    },
  };
}

export { isBridgeMessage };
