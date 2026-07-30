import { WebSocket } from "ws";
import type { Browser, CDPSession, Page } from "puppeteer";
import { DEFAULT_VIEWPORT, MJPEG_FRAME_TYPE, type ControlMessage } from "./protocol.js";

interface SessionOptions {
  sessionId: string;
  url: string;
  interactive: boolean;
  viewport?: { width: number; height: number };
}

interface Session {
  sessionId: string;
  page: Page;
  cdp: CDPSession;
  publishSocket: WebSocket;
  interactive: boolean;
  lastActivity: number;
  navStack: string[];
  navIndex: number;
  navigatingViaHistory: boolean;
  viewportWidth: number;
  viewportHeight: number;
  // Authoritative cursor position (CSS-pixel page space) for trackpad-style
  // relative control — a "move" action nudges this by dx/dy, and "click"/
  // "scroll" without explicit x/y act at this position. Absolute callers
  // (tap-on-mirror) keep it in sync by passing x/y as usual.
  cursorX: number;
  cursorY: number;
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // interactive sessions only — see sweepIdle()
const IDLE_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Owns every active headless-Chromium session: one Puppeteer page + one CDP
 * screencast + one dedicated STREAM_PUBLISH WS connection per session. The
 * control connection (register/start/stop/control) is separate and owned by
 * server.ts — this class only needs a way to send reports back over it.
 */
export class SessionManager {
  private readonly browser: Browser;
  private readonly wsGatewayUrl: string;
  private readonly maxSessions: number;
  // Chromium was launched with --force-device-scale-factor=this value (see
  // server.ts) — CDP's Page.startScreencast only honors the scale factor at
  // that global, launch-time level, not per-page/per-session, so this applies
  // uniformly to every session's captured (not layout) resolution.
  private readonly scaleFactor: number;
  private readonly sendControl: (msg: ControlMessage | Record<string, unknown>) => void;
  private readonly sessions = new Map<string, Session>();
  // In-flight start() calls, keyed by sessionId — closes the race where two
  // BROWSER_SESSION_START messages for the same (shared) sessionId arrive
  // before the first has finished `await`ing browser.newPage()/page.goto(),
  // both pass the `sessions.has()` check, and both spin up their own Puppeteer
  // page for one sessionId (the second `sessions.set()` then silently orphans
  // the first page/socket forever).
  private readonly pendingStarts = new Map<string, Promise<void>>();

  constructor(opts: {
    browser: Browser;
    wsGatewayUrl: string;
    maxSessions: number;
    scaleFactor: number;
    sendControl: (msg: ControlMessage | Record<string, unknown>) => void;
  }) {
    this.browser = opts.browser;
    this.wsGatewayUrl = opts.wsGatewayUrl;
    this.maxSessions = opts.maxSessions;
    this.scaleFactor = opts.scaleFactor;
    this.sendControl = opts.sendControl;
    setInterval(() => this.sweepIdle(), IDLE_SWEEP_INTERVAL_MS).unref();
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  async start(opts: SessionOptions): Promise<void> {
    const inFlight = this.pendingStarts.get(opts.sessionId);
    if (inFlight) {
      // Another start() for this exact sessionId is already creating the page.
      // The gateway adds every caller to that sessionId's owner set
      // synchronously, before it even forwards BROWSER_SESSION_START here, so
      // whichever status the in-flight start() eventually reports (ready or
      // error) is already broadcast to this caller too — nothing more to send.
      await inFlight;
      return;
    }

    if (this.sessions.has(opts.sessionId)) {
      // A restart request for a session that's already up — treat as a no-op
      // success rather than doubling the page.
      this.sendControl({ type: "BROWSER_SESSION_STATUS", sessionId: opts.sessionId, status: "ready" });
      return;
    }
    if (this.sessions.size >= this.maxSessions) {
      this.sendControl({
        type: "BROWSER_SESSION_STATUS",
        sessionId: opts.sessionId,
        status: "error",
        message: `Renderer at capacity (${this.maxSessions} sessions)`,
      });
      return;
    }

    // Reserve the sessionId synchronously (before any await below) so a
    // concurrent start() for the same id takes the inFlight branch above
    // instead of slipping past the `sessions.has()` check.
    const promise = this.doStart(opts).finally(() => this.pendingStarts.delete(opts.sessionId));
    this.pendingStarts.set(opts.sessionId, promise);
    await promise;
  }

  private async doStart(opts: SessionOptions): Promise<void> {
    const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
    let page: Page;
    try {
      page = await this.browser.newPage();
      // deviceScaleFactor here keeps Puppeteer's own bookkeeping (e.g.
      // page.screenshot(), were it ever used) consistent with how Chromium was
      // actually launched — it does NOT affect Page.startScreencast's captured
      // resolution below, which only follows the launch-level force flag.
      await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: this.scaleFactor });
    } catch (err) {
      this.sendControl({
        type: "BROWSER_SESSION_STATUS",
        sessionId: opts.sessionId,
        status: "error",
        message: `Failed to open page: ${(err as Error).message}`,
      });
      return;
    }

    const session: Session = {
      sessionId: opts.sessionId,
      page,
      cdp: await page.target().createCDPSession(),
      publishSocket: this.openPublishSocket(opts.sessionId),
      interactive: opts.interactive,
      lastActivity: Date.now(),
      navStack: [],
      navIndex: -1,
      navigatingViaHistory: false,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      cursorX: viewport.width / 2,
      cursorY: viewport.height / 2,
    };
    this.sessions.set(opts.sessionId, session);

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.recordNavigation(session, frame.url());
    });
    page.on("close", () => this.teardown(opts.sessionId));
    // target="_blank"/window.open() links open a brand-new Puppeteer page with
    // no CDP screencast/session wiring at all — invisible to this session, so
    // clicking such a link looks like nothing happened. Redirect the same
    // navigation into the existing page instead, keeping the "one Puppeteer
    // page per sessionId" design intact (the resulting nav flows through the
    // framenavigated handler above like any other navigation).
    page.on("popup", (popup) => {
      if (!popup) return;
      void (async () => {
        try {
          await popup.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5_000 }).catch(() => {});
          const targetUrl = popup.url();
          await popup.close().catch(() => {});
          if (targetUrl && targetUrl !== "about:blank") {
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
          }
        } catch (err) {
          console.error(`[sessions] popup handling failed for ${session.sessionId}:`, (err as Error).message);
        }
      })();
    });

    try {
      await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (err) {
      this.sendControl({
        type: "BROWSER_SESSION_STATUS",
        sessionId: opts.sessionId,
        status: "error",
        message: `Navigation failed: ${(err as Error).message}`,
      });
      await this.teardown(opts.sessionId);
      return;
    }

    await session.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      // maxWidth/maxHeight only ever CAPS the natural captured size, never
      // upscales — and that natural size follows Chromium's launch-level
      // forced scale factor (this.scaleFactor), not the CSS viewport alone.
      // Sizing the cap to match (rather than leaving it at plain CSS pixels)
      // is what actually yields a native-resolution, non-blurry capture.
      maxWidth: Math.round(viewport.width * this.scaleFactor),
      maxHeight: Math.round(viewport.height * this.scaleFactor),
      everyNthFrame: 1,
    });
    session.cdp.on("Page.screencastFrame", (frame) => {
      void this.onScreencastFrame(session, frame);
    });

    this.sendControl({ type: "BROWSER_SESSION_STATUS", sessionId: opts.sessionId, status: "ready" });
  }

  async stop(sessionId: string): Promise<void> {
    await this.teardown(sessionId);
  }

  /**
   * Resolve a control message's target position. Explicit x/y (the existing
   * tap-on-mirror callers) arrive in captured-bitmap pixel space — canvas.width
   * client-side is the JPEG's decoded width, viewport.width * this.scaleFactor
   * — so they're divided down to CSS-pixel/layout-viewport space, which is what
   * Puppeteer's mouse actually works in; this ALSO re-syncs the session's
   * tracked cursor, so a trackpad and a mirror-tap on the same shared session
   * stay coherent. Omitted x/y (trackpad-mode callers, already tracking their
   * own relative motion server-side via "move") resolves to wherever the
   * session's cursor currently is.
   */
  private resolvePosition(session: Session, x?: number, y?: number): { x: number; y: number } {
    if (x !== undefined && y !== undefined) {
      session.cursorX = x / this.scaleFactor;
      session.cursorY = y / this.scaleFactor;
    }
    return { x: session.cursorX, y: session.cursorY };
  }

  async control(msg: {
    sessionId: string;
    action: string;
    x?: number;
    y?: number;
    dx?: number;
    dy?: number;
    deltaY?: number;
    key?: string;
    text?: string;
    url?: string;
  }): Promise<void> {
    const session = this.sessions.get(msg.sessionId);
    if (!session) return;
    session.lastActivity = Date.now();
    const { page } = session;

    try {
      switch (msg.action) {
        case "navigate":
          if (msg.url) await page.goto(msg.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          break;
        case "back":
          session.navigatingViaHistory = true;
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 45_000 });
          break;
        case "forward":
          session.navigatingViaHistory = true;
          await page.goForward({ waitUntil: "domcontentloaded", timeout: 45_000 });
          break;
        case "reload":
          await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
          break;
        case "move": {
          // Trackpad-style relative motion — dx/dy are already raw CSS-pixel
          // deltas from a blank touch surface unrelated to the screencast's own
          // resolution, so (unlike click/scroll's explicit x/y) no scaleFactor
          // division applies here. Clamped to the real page bounds so repeated
          // drags can't walk the cursor off-page.
          if (msg.dx !== undefined && msg.dy !== undefined) {
            session.cursorX = Math.min(Math.max(session.cursorX + msg.dx, 0), session.viewportWidth);
            session.cursorY = Math.min(Math.max(session.cursorY + msg.dy, 0), session.viewportHeight);
            await page.mouse.move(session.cursorX, session.cursorY);
          }
          break;
        }
        case "click": {
          const { x, y } = this.resolvePosition(session, msg.x, msg.y);
          await page.mouse.click(x, y);
          break;
        }
        case "scroll":
          if (msg.deltaY !== undefined) {
            // A real CDP wheel event (not window.scrollBy) so Chromium's own hit-
            // testing picks the actual scrollable element under the cursor — most
            // real sites scroll an inner container, not the top-level window/body,
            // so scrollBy was a no-op on those pages. Positioning at the resolved
            // point first (explicit x/y, or the trackpad's tracked cursor) means a
            // drag/scroll over a specific scrollable panel scrolls THAT panel
            // rather than whatever's at the last click.
            const { x, y } = this.resolvePosition(session, msg.x, msg.y);
            await page.mouse.move(x, y);
            await page.mouse.wheel({ deltaY: msg.deltaY });
          }
          break;
        case "key":
          if (msg.key) await page.keyboard.press(msg.key as Parameters<Page["keyboard"]["press"]>[0]);
          break;
        case "type":
          if (msg.text) await page.keyboard.type(msg.text);
          break;
      }
    } catch (err) {
      // A single failed control action (e.g. click after the page navigated away
      // mid-flight) shouldn't kill the session — just log it.
      console.error(`[sessions] control action "${msg.action}" failed for ${msg.sessionId}:`, (err as Error).message);
    }
  }

  /** Interactive sessions with no control activity for IDLE_TIMEOUT_MS are freed. */
  private sweepIdle(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.interactive && now - session.lastActivity > IDLE_TIMEOUT_MS) {
        void this.teardown(sessionId);
      }
    }
  }

  private recordNavigation(session: Session, url: string): void {
    if (!session.navigatingViaHistory) {
      session.navStack = session.navStack.slice(0, session.navIndex + 1);
      session.navStack.push(url);
      session.navIndex = session.navStack.length - 1;
    }
    session.navigatingViaHistory = false;
    this.sendControl({
      type: "BROWSER_PAGE_NAVIGATED",
      sessionId: session.sessionId,
      url,
      canGoBack: session.navIndex > 0,
      canGoForward: session.navIndex < session.navStack.length - 1,
    });
  }

  private async onScreencastFrame(
    session: Session,
    frame: { data: string; sessionId: number }
  ): Promise<void> {
    session.lastActivity = Date.now();
    try {
      const jpeg = Buffer.from(frame.data, "base64");
      const header = Buffer.alloc(9);
      header.writeUInt8(MJPEG_FRAME_TYPE, 0);
      header.writeBigUInt64LE(BigInt(Date.now()) * 1000n, 1);
      if (session.publishSocket.readyState === WebSocket.OPEN) {
        session.publishSocket.send(Buffer.concat([header, jpeg]));
      }
    } finally {
      // Must ack every frame (by its CDP screencast session id, not ours) or the
      // browser stops sending new ones. Logged rather than swallowed — a
      // silently-failing ack looks identical to "everything's fine" right up
      // until the screencast permanently stalls after this one frame.
      await session.cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch((err) => {
        console.error(`[sessions] screencastFrameAck failed for ${session.sessionId}:`, (err as Error).message);
      });
    }
  }

  private openPublishSocket(sessionId: string): WebSocket {
    const sock = new WebSocket(this.wsGatewayUrl);
    sock.on("open", () => {
      sock.send(JSON.stringify({ type: "STREAM_PUBLISH", streamId: sessionId, format: "mjpeg" }));
    });
    sock.on("error", (err) => console.error(`[sessions] publish socket error for ${sessionId}:`, err.message));
    sock.on("close", () => {
      const session = this.sessions.get(sessionId);
      // Only reconnect if the session is still alive and this socket is still
      // the one it's using — teardown() deletes the session before closing
      // this socket deliberately, and that must NOT respawn a new one. Without
      // this, any drop of this socket (network blip, gateway hiccup) silently
      // stops every future frame forever even though Puppeteer/CDP keeps
      // screencasting and acking normally — the same "one frame then stale"
      // symptom as an ack failure, just from the other end of the pipe.
      if (session && session.publishSocket === sock) {
        console.warn(`[sessions] publish socket closed for ${sessionId} — reconnecting`);
        session.publishSocket = this.openPublishSocket(sessionId);
      }
    });
    return sock;
  }

  private async teardown(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    try {
      await session.cdp.send("Page.stopScreencast").catch(() => {});
      if (!session.page.isClosed()) await session.page.close();
    } catch (err) {
      console.error(`[sessions] teardown error for ${sessionId}:`, (err as Error).message);
    }
    // Closing this triggers the gateway's existing "publisher gone" cleanup —
    // no explicit unpublish message needed (see apps/api/src/ws/gateway.ts).
    session.publishSocket.close();
  }
}
