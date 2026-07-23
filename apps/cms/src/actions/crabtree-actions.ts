"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { sendIrCommand } from "./ir-actions";
import { IR_REMOTES, IR_AC } from "@/lib/ir-devices";

export interface CrabAck {
  status: string;
  detail?: string;
}

export async function sendCrabCommand(
  device: string,
  command: string,
  params?: Record<string, unknown>
): Promise<CrabAck> {
  await requireAdmin();

  let uuid: string | undefined;
  if (device === "ac") uuid = IR_AC.uuid;
  else if (device === "tv") uuid = IR_REMOTES.find(r => r.label === "TV" || r.irDevice === "tv")?.uuid;
  else if (device === "soundbar") uuid = IR_REMOTES.find(r => r.label === "Soundbar" || r.irDevice === "soundbar")?.uuid;
  else throw new Error(`Unknown device: ${device}`);

  if (!uuid || uuid.startsWith("REPLACE_")) {
    throw new Error(`Device UUID not configured for ${device}`);
  }

  try {
    await sendIrCommand(uuid, command, params);
    return { status: "ok" };
  } catch (err: any) {
    throw new Error(err.message || "IR command failed.");
  }
}

/**
 * Press the TV's Power key.
 */
export async function pressTvPower(): Promise<CrabAck> {
  return sendCrabCommand("tv", "Power");
}
