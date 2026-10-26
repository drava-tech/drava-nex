import type { WsContent } from "@platform/types";
import { isGreetingEnabled } from "./greeting-flag.js";

/**
 * How the Welcome screen should behave on the TV — decided here, once, and
 * delivered to the player inside the content it already receives. There is no
 * player-side env var: WelcomeRenderer just obeys `muted` / `narrate`.
 *
 *   WELCOME_VIDEO_MUTED   true | false | unset
 *     unset + GREETING_ENABLED on   -> muted (the spoken greeting owns the audio)
 *     unset + GREETING_ENABLED off  -> untouched: exactly today's behaviour
 *     true / false                  -> that, in both cases
 *
 *   narrate: false  only while GREETING_ENABLED is on, so the renderer's own
 *   headline narration doesn't talk over the GREET voice line.
 *
 * The flags are added to the OUTGOING copy only (templateContent.welcome.muted /
 * .narrate); nothing is written back to the experience, so the CMS editor never
 * sees or saves them.
 */

type Env = Record<string, string | undefined>;

/** null = leave the video's sound exactly as authored. */
export function welcomeVideoMuted(env: Env = process.env): boolean | null {
  const raw = env["WELCOME_VIDEO_MUTED"]?.trim().toLowerCase();
  if (raw && ["1", "true", "yes", "on"].includes(raw)) return true;
  if (raw && ["0", "false", "no", "off"].includes(raw)) return false;
  return isGreetingEnabled(env) ? true : null;
}

export function applyWelcomePolicy(content: WsContent | null, env: Env = process.env): WsContent | null {
  if (!content || content.type !== "experience" || content.templateKey !== "welcome") return content;

  const muted = welcomeVideoMuted(env);
  const narrate = isGreetingEnabled(env) ? false : null;
  if (muted === null && narrate === null) return content; // same object: nothing changes

  const templateContent = content.templateContent ?? {};
  const welcome = (templateContent["welcome"] ?? {}) as Record<string, unknown>;
  return {
    ...content,
    templateContent: {
      ...templateContent,
      welcome: {
        ...welcome,
        ...(muted !== null ? { muted } : {}),
        ...(narrate !== null ? { narrate } : {}),
      },
    },
  };
}
