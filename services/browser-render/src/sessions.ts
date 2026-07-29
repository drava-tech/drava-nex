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
  private readonly sendControl: (msg: ControlMessage | Record<string, unknown>) => void;
  private readonly sessions = new Map<string, Session>();

  constructor(opts: {
    browser: Browser;
    wsGatewayUrl: string;
    maxSessions: number;
    sendControl: (msg: ControlMessage | Record<string, unknown>) => void;
  }) {
    this.browser = opts.browser;
    this.wsGatewayUrl = opts.wsGatewayUrl;
    this.maxSessions = opts.maxSessions;
    this.sendControl = opts.sendControl;
    setInterval(() => this.sweepIdle(), IDLE_SWEEP_INTERVAL_MS).unref();
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  async start(opts: SessionOptions): Promise<void> {
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

    const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
    let page: Page;
    try {
      page = await this.browser.newPage();
      await page.setViewport(viewport);
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
    };
    this.sessions.set(opts.sessionId, session);

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.recordNavigation(session, frame.url());
    });
    page.on("close", () => this.teardown(opts.sessionId));

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
      quality: 80,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
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

  async control(msg: {
    sessionId: string;
    action: string;
    x?: number;
    y?: number;
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
        case "click":
          if (msg.x !== undefined && msg.y !== undefined) await page.mouse.click(msg.x, msg.y);
          break;
        case "scroll":
          if (msg.deltaY !== undefined) {
            await page.evaluate((dy) => window.scrollBy(0, dy), msg.deltaY);
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
      // browser stops sending new ones.
      await session.cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    }
  }

  private openPublishSocket(sessionId: string): WebSocket {
    const sock = new WebSocket(this.wsGatewayUrl);
    sock.on("open", () => {
      sock.send(JSON.stringify({ type: "STREAM_PUBLISH", streamId: sessionId, format: "mjpeg" }));
    });
    sock.on("error", (err) => console.error(`[sessions] publish socket error for ${sessionId}:`, err.message));
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
