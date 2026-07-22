"use server";

import { requireAdmin } from "@/lib/auth-helpers";

/**
 * Direct bridge to the running CrabController IR webapp (POST :8000/command) —
 * the same endpoint its bundled control page uses. Powers the quick header
 * controls (AC on/off) without the MQTT/device-registration round-trip. Payload
 * is CrabController's contract: { device, command, params }. AC verbs are
 * power_on|power_off|set_temp|set_mode|set_fan; other remotes use codebook keys.
 */
const CRAB_URL = process.env["CRABCONTROLLER_URL"] ?? "http://localhost:8000";

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

  let res: Response;
  try {
    res = await fetch(`${CRAB_URL}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device, command, params: params ?? {} }),
      cache: "no-store",
    });
  } catch {
    throw new Error(`Could not reach the IR bridge at ${CRAB_URL}.`);
  }

  const ack = (await res.json().catch(() => null)) as CrabAck | null;
  if (!res.ok || ack?.status !== "ok") {
    throw new Error(ack?.detail || `IR command failed (${res.status}).`);
  }
  return ack;
}

/**
 * Press the TV's Power key (CrabController `tv` remote). The TV codebook exposes
 * only a single Power toggle, so every press flips the TV between on and off.
 */
export async function pressTvPower(): Promise<CrabAck> {
  return sendCrabCommand("tv", "Power");
}
