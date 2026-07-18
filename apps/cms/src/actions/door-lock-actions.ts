"use server";

import { requireAdmin } from "@/lib/auth-helpers";

export async function toggleDoorLock(action: "locked" | "unlocked") {
  await requireAdmin();

  const haUrl = process.env.HA_URL || "http://192.168.0.250:8123";
  const haToken = process.env.HA_TOKEN;
  const haEntityId = process.env.HA_ENTITY_ID || "lock.experience_center_experience_center";

  if (!haToken) {
    throw new Error("Home Assistant is not configured. Set HA_TOKEN in your .env file.");
  }

  const service = action === "locked" ? "lock" : "unlock";
  const haRes = await fetch(`${haUrl}/api/services/lock/${service}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${haToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entity_id: haEntityId }),
  });

  if (!haRes.ok) {
    const text = await haRes.text();
    throw new Error(`Home Assistant error (${haRes.status}): ${text}`);
  }

  return { success: true };
}
