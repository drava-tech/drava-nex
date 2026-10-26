import { getScreenContent as getScreenContentFromDb } from "@platform/db";
import type { WsContent } from "@platform/types";
import { applyWelcomePolicy } from "./welcome-policy.js";

/**
 * The content a screen should show, as the API hands it to a TV. Every API path
 * that builds screen content (WELCOME on connect, pushes, GET /config, takeover
 * resets) goes through here, so the welcome policy has one place to apply.
 * With GREETING_ENABLED and WELCOME_VIDEO_MUTED unset, this returns exactly what
 * the database query returned.
 */
export async function getScreenContent(screenId: string): Promise<WsContent | null> {
  return applyWelcomePolicy(await getScreenContentFromDb(screenId));
}
