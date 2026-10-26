"use client";

import { useEffect, useState } from "react";
import { getGreetingStatus, type GreetingStatusDto } from "@/actions/greeting-actions";

const POLL_MS = 30_000;

/**
 * Small read-only status pill next to the Welcome Trigger toggle. Renders nothing
 * while greet-on-arrival is off (and stops polling), so the header is unchanged
 * for anyone not using it.
 *
 *   green  - on, armed, TV connected, nothing wrong
 *   amber  - disarmed, TV offline, or the TV could not speak the last greeting
 *   red    - the database breaker is paused (greetings are on hold)
 */
export function GreetingStatusBadge() {
  const [status, setStatus] = useState<GreetingStatusDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const next = await getGreetingStatus();
        if (cancelled) return;
        setStatus(next);
        if (next?.enabled) timer = setTimeout(tick, POLL_MS); // off => never poll again
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!status || !status.enabled) return null;

  const problems: string[] = [];
  if (status.breaker.paused) problems.push(`On hold after an error: ${status.breaker.lastError ?? "database"}`);
  if (!status.armed) problems.push("Disarmed (Welcome Trigger is OFF)");
  if (!status.screen.online) problems.push(`${status.screen.id} has no connected player`);
  if (status.lastTvAck && !status.lastTvAck.spoke) problems.push(`TV could not speak: ${status.lastTvAck.error ?? "unknown"}`);

  const tone = status.breaker.paused ? "bg-red-500" : problems.length > 0 ? "bg-amber-400" : "bg-green-500";
  const skipped = status.today.skipped;
  const detail = [
    `Voice: ${status.voice}${status.voiceName ? ` (${status.voiceName})` : ""}, names: ${status.nameMode}`,
    `Today: ${status.today.greeted} greeted, ${skipped} skipped${
      skipped ? ` (${Object.entries(status.today.skippedByReason).map(([r, n]) => `${r} ${n}`).join(", ")})` : ""
    }`,
    status.lastGreeting
      ? `Last: ${status.lastGreeting.text ?? "(screen only)"} at ${new Date(status.lastGreeting.at).toLocaleTimeString()}`
      : "Last: none since the API started",
    status.lastTvAck
      ? `TV: ${status.lastTvAck.spoke ? `spoke${status.lastTvAck.voice ? ` with ${status.lastTvAck.voice}` : ""}` : `did not speak (${status.lastTvAck.error ?? "?"})`}`
      : "TV: no speech reported yet",
    ...problems,
  ].join("\n");

  return (
    <span
      className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-xs text-white/80"
      title={detail}
    >
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden />
      Greetings · {status.today.greeted} today{skipped ? ` · ${skipped} skipped` : ""}
    </span>
  );
}
