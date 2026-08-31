import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const {
  getScreenContent,
  resetScreenToIdle,
  clearRecentContentForScreen,
  setScreenExperience,
} = vi.hoisted(() => ({
  getScreenContent: vi.fn().mockResolvedValue(null),
  resetScreenToIdle: vi.fn().mockResolvedValue(undefined),
  clearRecentContentForScreen: vi.fn().mockResolvedValue(undefined),
  setScreenExperience: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@platform/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platform/db")>();
  return {
    ...actual,
    getScreenContent,
    resetScreenToIdle,
    clearRecentContentForScreen,
    setScreenExperience,
    getScreenWhiteboardState: vi.fn().mockResolvedValue(null),
    setScreenWhiteboardState: vi.fn().mockResolvedValue(undefined),
    getScreenBlanked: vi.fn().mockResolvedValue(false),
  };
});

import { createGateway, broadcast } from "../src/ws/gateway.js";
import type { WsContent } from "@platform/types";

class MockWebSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.emit("close");
  }
}

describe("Gateway freshLaunch and viewStateCache behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears recents and resets screen to idle on REGISTER with freshLaunch: true", async () => {
    const wss = createGateway();
    const ws = new MockWebSocket();
    wss.emit("connection", ws as any, {} as any);

    // Register screen with freshLaunch: true (simulating kiosk EXE process launch)
    ws.emit("message", JSON.stringify({
      type: "REGISTER",
      screenId: "screen-fresh-1",
      preview: false,
      freshLaunch: true,
    }));

    // Wait for the async handlers to resolve
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(clearRecentContentForScreen).toHaveBeenCalledWith("screen-fresh-1");
    expect(resetScreenToIdle).toHaveBeenCalledWith("screen-fresh-1");

    // Welcome message sent with IDLE_WS_CONTENT
    const welcome = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === "WELCOME");
    expect(welcome).toBeDefined();
    expect(welcome.screenId).toBe("screen-fresh-1");
  });

  it("does not clear recents on REGISTER with freshLaunch: false", async () => {
    const wss = createGateway();
    const ws = new MockWebSocket();
    wss.emit("connection", ws as any, {} as any);

    ws.emit("message", JSON.stringify({
      type: "REGISTER",
      screenId: "screen-reconnect-1",
      preview: false,
      freshLaunch: false,
    }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(clearRecentContentForScreen).not.toHaveBeenCalled();
    expect(resetScreenToIdle).not.toHaveBeenCalled();
  });

  it("preserves viewStateCache when broadcasting the same content", async () => {
    const wss = createGateway();
    const ws = new MockWebSocket();
    wss.emit("connection", ws as any, {} as any);

    const portfolioContent: WsContent = {
      id: "exp-portfolio",
      type: "experience",
      title: "Portfolio",
      templateKey: "portfolio",
      source: "",
    };

    // Screen registers with portfolio already active
    getScreenContent.mockResolvedValueOnce(portfolioContent as any);
    ws.emit("message", JSON.stringify({
      type: "REGISTER",
      screenId: "screen-viewstate-1",
      preview: false,
      freshLaunch: false,
    }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    // User navigates portfolio to card 2
    ws.emit("message", JSON.stringify({
      type: "SCREEN_INTERACTION",
      screenId: "screen-viewstate-1",
      command: "SET_PORTFOLIO_VIEW",
      value: { cardIndex: 2, sectionIndex: 1 },
    }));

    // Broadcast same portfolio content (re-push)
    broadcast({ screenId: "screen-viewstate-1", content: portfolioContent, source: "cms" });

    // Now a CMS live mirror connects
    const mirrorWs = new MockWebSocket();
    wss.emit("connection", mirrorWs as any, {} as any);
    mirrorWs.emit("message", JSON.stringify({
      type: "REGISTER",
      screenId: "screen-viewstate-1",
      preview: true,
      freshLaunch: false,
    }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Mirror must receive replayed SET_PORTFOLIO_VIEW with cardIndex 2
    const replayed = mirrorWs.sent
      .map((s) => JSON.parse(s))
      .find((m) => m.type === "SCREEN_COMMAND" && m.command === "SET_PORTFOLIO_VIEW");

    expect(replayed).toBeDefined();
    expect(replayed.value).toEqual({ cardIndex: 2, sectionIndex: 1 });
  });

  // The headline behaviour: portfolio -> explore -> push a PDF -> push
  // portfolio again must land back on the explored view, not restart it.
  it("restores a content's own view state when it is pushed again after switching away", async () => {
    const wss = createGateway();
    const ws = new MockWebSocket();
    wss.emit("connection", ws as any, {} as any);

    const screenId = "screen-resume-1";
    const portfolio: WsContent = {
      id: "exp-portfolio",
      type: "experience",
      title: "Portfolio",
      templateKey: "portfolio",
      source: "",
    };
    const pdf: WsContent = { id: "media-pdf", type: "html", title: "Deck.pdf", source: "/media/deck.pdf" };

    getScreenContent.mockResolvedValueOnce(portfolio as any);
    ws.emit("message", JSON.stringify({ type: "REGISTER", screenId, preview: false, freshLaunch: false }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Explore into the portfolio.
    ws.emit("message", JSON.stringify({
      type: "SCREEN_INTERACTION",
      screenId,
      command: "SET_PORTFOLIO_VIEW",
      value: { cardIndex: 3, sectionIndex: 2 },
    }));

    // Switch the screen away to a PDF — the PDF must NOT inherit the
    // portfolio's position.
    ws.sent.length = 0;
    broadcast({ screenId, content: pdf, source: "cms" });
    const duringPdf = ws.sent
      .map((s) => JSON.parse(s))
      .find((m) => m.type === "SCREEN_COMMAND" && m.command === "SET_PORTFOLIO_VIEW");
    expect(duringPdf).toBeUndefined();

    // Switch back to the portfolio — its own position must be restored.
    ws.sent.length = 0;
    broadcast({ screenId, content: portfolio, source: "cms" });
    const restored = ws.sent
      .map((s) => JSON.parse(s))
      .find((m) => m.type === "SCREEN_COMMAND" && m.command === "SET_PORTFOLIO_VIEW");

    expect(restored).toBeDefined();
    expect(restored.value).toEqual({ cardIndex: 3, sectionIndex: 2 });
  });

  // Guards the user's explicit requirement that reopening the kiosk app is a
  // genuine cold start, NOT a resume.
  it("drops remembered view state on a fresh launch, so a reopened kiosk starts clean", async () => {
    const wss = createGateway();
    const ws = new MockWebSocket();
    wss.emit("connection", ws as any, {} as any);

    const screenId = "screen-resume-2";
    const portfolio: WsContent = {
      id: "exp-portfolio",
      type: "experience",
      title: "Portfolio",
      templateKey: "portfolio",
      source: "",
    };

    getScreenContent.mockResolvedValueOnce(portfolio as any);
    ws.emit("message", JSON.stringify({ type: "REGISTER", screenId, preview: false, freshLaunch: false }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    ws.emit("message", JSON.stringify({
      type: "SCREEN_INTERACTION",
      screenId,
      command: "SET_PORTFOLIO_VIEW",
      value: { cardIndex: 4, sectionIndex: 1 },
    }));

    // The kiosk process restarts.
    const relaunched = new MockWebSocket();
    wss.emit("connection", relaunched as any, {} as any);
    relaunched.emit("message", JSON.stringify({ type: "REGISTER", screenId, preview: false, freshLaunch: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(resetScreenToIdle).toHaveBeenCalledWith(screenId);

    // Pushing the portfolio back must now start it fresh — the pre-restart
    // position is gone.
    relaunched.sent.length = 0;
    broadcast({ screenId, content: portfolio, source: "cms" });
    const afterRestart = relaunched.sent
      .map((s) => JSON.parse(s))
      .find((m) => m.type === "SCREEN_COMMAND" && m.command === "SET_PORTFOLIO_VIEW");

    expect(afterRestart).toBeUndefined();
  });

  // Change 3: the CMS must be told what the screen actually settled on.
  it("broadcasts the resolved content to CMS tabs on fresh launch, not a hardcoded idle sentinel", async () => {
    const wss = createGateway();

    const cmsWs = new MockWebSocket();
    wss.emit("connection", cmsWs as any, {} as any);
    cmsWs.emit("message", JSON.stringify({ type: "CMS_REGISTER" }));

    const screenId = "screen-resume-3";
    const realContent: WsContent = {
      id: "exp-portfolio",
      type: "experience",
      title: "Portfolio",
      templateKey: "portfolio",
      source: "",
    };
    // The DB still resolves real content after the reset (e.g. a push landed
    // alongside it) — the CMS must hear about THAT, not "nothing assigned".
    getScreenContent.mockResolvedValueOnce(realContent as any);

    const screenWs = new MockWebSocket();
    wss.emit("connection", screenWs as any, {} as any);
    cmsWs.sent.length = 0;
    screenWs.emit("message", JSON.stringify({ type: "REGISTER", screenId, preview: false, freshLaunch: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const updated = cmsWs.sent
      .map((s) => JSON.parse(s))
      .find((m) => m.type === "SCREEN_UPDATED" && m.screenId === screenId);

    expect(updated).toBeDefined();
    expect(updated.content.id).toBe("exp-portfolio");
    expect(updated.content.title).toBe("Portfolio");
  });
});
