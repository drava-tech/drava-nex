import { requireAdmin } from "@/lib/auth-helpers";
import { listDoorEvents } from "@platform/db";
import { DoorLockClient } from "./door-lock-client";

export const dynamic = "force-dynamic";


export default async function DoorLockPage() {
  await requireAdmin();

  const result = await listDoorEvents(5);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Door Lock</h1>
        <p className="text-sm text-muted-foreground">
          Live activity from the Yale lock webhook (IFTTT → MQTT bridge).
        </p>
      </div>
      <DoorLockClient
        events={result.items.map((e) => ({
          id: e.id,
          lockId: e.lockId,
          action: e.action as "locked" | "unlocked",
          createdAt: e.createdAt.toISOString(),
        }))}
        total={result.total}
      />
    </div>
  );
}
