import type { Resolution } from "../commands/resolve.js";
import type { EventLog } from "../utils/logger.js";
import { CmsError, type CmsClient } from "./client.js";

/**
 * Runs a resolved command and returns the sentence to speak. The CMS's own
 * message is spoken as-is on success AND failure: its errors already name the
 * real options ("I couldn't find a screen called ... The screens are: A, B."),
 * so nothing here invents or paraphrases device/screen names.
 */
export async function executeResolution(
  resolution: Resolution,
  cms: Pick<CmsClient, "send">,
  log: EventLog
): Promise<string> {
  if (resolution.kind === "reply") return resolution.text;
  if (resolution.kind === "ask") return resolution.question;

  const { request } = resolution;
  log.event("CMS_REQUEST", { endpoint: request.endpoint, body: request.body });
  try {
    const result = await cms.send(request);
    log.event("CMS_RESPONSE", { ok: true, message: result.message });
    return result.message || "Done.";
  } catch (err) {
    const code = err instanceof CmsError ? err.code : "INTERNAL";
    const message = err instanceof Error ? err.message : "Something went wrong.";
    log.event("CMS_RESPONSE", { ok: false, code, message });
    return message;
  }
}
