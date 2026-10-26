import { describe, expect, it } from "vitest";
import type { WsContent } from "@platform/types";
import { applyWelcomePolicy, welcomeVideoMuted } from "../src/lib/welcome-policy.js";

const welcome = (): WsContent => ({
  id: "exp-1",
  type: "experience",
  title: "Welcome Screen",
  templateKey: "welcome",
  templateContent: { welcome: { title: "Hi", videoUrl: "/media/v.mp4" } },
});

const flags = (c: WsContent | null) => (c?.templateContent?.["welcome"] ?? {}) as Record<string, unknown>;

describe("welcomeVideoMuted", () => {
  it("unset: muted when greetings are on, untouched (null) when off", () => {
    expect(welcomeVideoMuted({ GREETING_ENABLED: "true" })).toBe(true);
    expect(welcomeVideoMuted({})).toBeNull();
    expect(welcomeVideoMuted({ GREETING_ENABLED: "false" })).toBeNull();
  });

  it("true / false override in both cases", () => {
    for (const greeting of ["true", "false"]) {
      expect(welcomeVideoMuted({ GREETING_ENABLED: greeting, WELCOME_VIDEO_MUTED: "true" })).toBe(true);
      expect(welcomeVideoMuted({ GREETING_ENABLED: greeting, WELCOME_VIDEO_MUTED: "false" })).toBe(false);
      expect(welcomeVideoMuted({ GREETING_ENABLED: greeting, WELCOME_VIDEO_MUTED: " TRUE " })).toBe(true);
      expect(welcomeVideoMuted({ GREETING_ENABLED: greeting, WELCOME_VIDEO_MUTED: "0" })).toBe(false);
    }
  });

  it("an unrecognised value behaves like unset", () => {
    expect(welcomeVideoMuted({ GREETING_ENABLED: "true", WELCOME_VIDEO_MUTED: "maybe" })).toBe(true);
    expect(welcomeVideoMuted({ WELCOME_VIDEO_MUTED: "" })).toBeNull();
  });
});

describe("applyWelcomePolicy", () => {
  it("flag off, WELCOME_VIDEO_MUTED unset: returns the very same object (today's behaviour)", () => {
    const c = welcome();
    expect(applyWelcomePolicy(c, {})).toBe(c);
  });

  it("flag on, unset: muted and no narration", () => {
    const out = applyWelcomePolicy(welcome(), { GREETING_ENABLED: "true" });
    expect(flags(out)).toMatchObject({ title: "Hi", videoUrl: "/media/v.mp4", muted: true, narrate: false });
  });

  it("flag on, WELCOME_VIDEO_MUTED=false: unmuted but still no narration", () => {
    const out = applyWelcomePolicy(welcome(), { GREETING_ENABLED: "true", WELCOME_VIDEO_MUTED: "false" });
    expect(flags(out)).toMatchObject({ muted: false, narrate: false });
  });

  it("flag off, WELCOME_VIDEO_MUTED=true: muted, but narration left as it is today", () => {
    const out = applyWelcomePolicy(welcome(), { WELCOME_VIDEO_MUTED: "true" });
    expect(flags(out).muted).toBe(true);
    expect("narrate" in flags(out)).toBe(false);
  });

  it("never mutates the input (nothing leaks back into stored content)", () => {
    const c = welcome();
    const before = JSON.stringify(c);
    applyWelcomePolicy(c, { GREETING_ENABLED: "true" });
    expect(JSON.stringify(c)).toBe(before);
  });

  it("leaves other content alone", () => {
    const portfolio: WsContent = { id: "p", type: "experience", templateKey: "portfolio", templateContent: {} };
    const video: WsContent = { id: "v", type: "video", source: "/media/x.mp4", muted: false };
    const env = { GREETING_ENABLED: "true", WELCOME_VIDEO_MUTED: "true" };
    expect(applyWelcomePolicy(portfolio, env)).toBe(portfolio);
    expect(applyWelcomePolicy(video, env)).toBe(video);
    expect(applyWelcomePolicy(null, env)).toBeNull();
  });

  it("works when the experience has no welcome slice yet", () => {
    const bare: WsContent = { id: "e", type: "experience", templateKey: "welcome" };
    expect(flags(applyWelcomePolicy(bare, { GREETING_ENABLED: "true" }))).toEqual({ muted: true, narrate: false });
  });
});
