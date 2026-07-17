"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@platform/ui";
import { useCmsScreenSync, type DoorEventMessage } from "@/hooks/useCmsScreenSync";
import { toggleDoorLock } from "@/actions/door-lock-actions";

export interface DoorEventItem {
  id: string;
  lockId: string;
  action: "locked" | "unlocked";
  createdAt: string;
}

interface Props {
  events: DoorEventItem[];
  total: number;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function DoorLockClient({ events, total: initialTotal }: Props) {
  const [items, setItems] = useState<DoorEventItem[]>(events);
  const [total, setTotal] = useState(initialTotal);
  const [live, setLive] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => setItems(events), [events]);
  useEffect(() => setTotal(initialTotal), [initialTotal]);

  const onDoorEvent = useCallback((e: DoorEventMessage) => {
    setTotal(e.total);
    setItems((prev) => [
      { id: e.id, lockId: e.lockId, action: e.action, createdAt: e.createdAt },
      ...prev,
    ].slice(0, 5));
  }, []);

  useCmsScreenSync({ onDoorEvent, onConnectionChange: setLive });

  const current = items[0]?.action ?? null;

  const handleToggle = async (targetAction: "locked" | "unlocked") => {
    setIsPending(true);
    setErrorMsg(null);
    try {
      await toggleDoorLock(targetAction);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to toggle lock.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Current state:</span>
          {current === null ? (
            <Badge variant="secondary">Unknown</Badge>
          ) : (
            <Badge variant={current === "unlocked" ? "destructive" : "secondary"}>
              {current === "unlocked" ? "Unlocked" : "Locked"}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 border-l pl-4">
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => handleToggle(current === "unlocked" ? "locked" : "unlocked")}
          >
            {current === "unlocked" ? "Lock Door" : "Unlock Door"}
          </Button>
        </div>

        {isPending && <span className="text-xs text-muted-foreground animate-pulse">Updating...</span>}
        {errorMsg && <span className="text-xs text-destructive font-medium">{errorMsg}</span>}

        <span className="text-sm text-muted-foreground">
          {total} event{total === 1 ? "" : "s"} total
        </span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium ${
            live ? "text-green-600" : "text-muted-foreground"
          }`}
          title={live ? "Receiving live lock events" : "Reconnecting…"}
        >
          <span className={`h-2 w-2 rounded-full ${live ? "bg-green-500" : "bg-muted-foreground/50"}`} />
          {live ? "Live" : "Offline"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Lock</th>
              <th className="px-4 py-3 text-left font-medium">Action</th>
              <th className="px-4 py-3 text-left font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No lock events yet.
                </td>
              </tr>
            )}
            {items.map((e) => (
              <tr key={e.id} className="border-b last:border-0">
                <td className="px-4 py-3 text-muted-foreground">{e.lockId}</td>
                <td className="px-4 py-3">
                  <Badge variant={e.action === "unlocked" ? "destructive" : "secondary"}>
                    {e.action === "unlocked" ? "Unlocked" : "Locked"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatTime(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
