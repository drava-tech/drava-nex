import { isScreenIdle, setScreenExperience, getExperienceIdBySlug } from "@platform/db";
import { pushScreenContent } from "../routes/screens.js";

const MAIN_SCREEN_ID = "main-screen";
const WELCOME_EXPERIENCE_SLUG = "welcome-screen";

// Manual kill-switch for the camera-presence trigger: default armed, so any
// detected person (identity doesn't matter — see PERSON_PRESENT in
// internal.ts) switches the idle main-screen to Welcome automatically. Flip
// off via /api/vision-trigger (Visitors page) to pause it temporarily.
// In-memory only (resets to armed on API restart) — not a persisted setting.
let visionTriggerArmed = true;

export function isVisionTriggerArmed(): boolean {
  return visionTriggerArmed;
}

export function setVisionTriggerArmed(armed: boolean): void {
  visionTriggerArmed = armed;
}

/**
 * Switches main-screen to the Welcome experience if idle (showing the default
 * video) — never interrupts real assigned content. Logs the timing from the
 * triggering event to the screen actually updating, so latency is visible
 * without needing to check the DB by hand.
 */
export async function showWelcomeScreenIfIdle(triggeredAt: Date): Promise<boolean> {
  const start = Date.now();
  const idle = await isScreenIdle(MAIN_SCREEN_ID);
  if (!idle) {
    console.info(
      `[door-screen] trigger at ${triggeredAt.toISOString()} — main-screen not idle, left untouched`
    );
    return false;
  }

  const welcomeExperienceId = await getExperienceIdBySlug(WELCOME_EXPERIENCE_SLUG);
  if (!welcomeExperienceId) {
    console.warn(
      `[door-screen] trigger at ${triggeredAt.toISOString()} — welcome-screen experience not found, skipped`
    );
    return false;
  }

  await setScreenExperience(MAIN_SCREEN_ID, welcomeExperienceId);
  await pushScreenContent(MAIN_SCREEN_ID);

  const screenUpdatedAt = new Date();
  const elapsedMs = Date.now() - start;
  console.info(
    `[door-screen] trigger at ${triggeredAt.toISOString()} -> main-screen switched to welcome ` +
    `at ${screenUpdatedAt.toISOString()} (${elapsedMs}ms)`
  );
  return true;
}
