import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "../client.js";
import { device, type Device } from "../schema/devices.js";

/** All non-deleted devices, newest first. */
export async function listDevices(): Promise<Device[]> {
  return db
    .select()
    .from(device)
    .where(isNull(device.deletedAt))
    .orderBy(desc(device.createdAt));
}

export async function getDevice(id: string): Promise<Device | null> {
  const [row] = await db
    .select()
    .from(device)
    .where(and(eq(device.id, id), isNull(device.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getDeviceByDeviceId(deviceId: string): Promise<Device | null> {
  const [row] = await db
    .select()
    .from(device)
    .where(and(eq(device.deviceId, deviceId), isNull(device.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Insert or update a device by its external deviceId — lets clients self-register. */
export async function upsertDevice(input: {
  deviceId: string;
  type: string;
  name: string;
  config?: Record<string, unknown>;
}): Promise<Device> {
  const [row] = await db
    .insert(device)
    .values({
      deviceId: input.deviceId,
      type: input.type,
      name: input.name,
      ...(input.config ? { config: input.config } : {}),
    })
    .onConflictDoUpdate({
      target: device.deviceId,
      set: {
        type: input.type,
        name: input.name,
        ...(input.config ? { config: input.config } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("Failed to upsert device");
  return row;
}

/** Replace a device's last-known state and stamp lastSeenAt. */
export async function setDeviceState(
  id: string,
  state: Record<string, unknown>
): Promise<Device> {
  const [row] = await db
    .update(device)
    .set({ state, lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(device.id, id))
    .returning();
  if (!row) throw new Error("Device not found");
  return row;
}

export async function setDeviceStatus(deviceId: string, status: string): Promise<void> {
  await db
    .update(device)
    .set({ status, lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(device.deviceId, deviceId));
}
