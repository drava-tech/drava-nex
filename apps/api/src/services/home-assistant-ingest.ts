import WebSocket from "ws";
import { broadcastToCms } from "../ws/gateway.js";

/**
 * Subscribes to Home Assistant's websocket API so the CMS reflects real-world
 * lock changes the moment they happen — a keypad entry, the Yale app, HA's own
 * dashboard, or auto-lock — not just commands the CMS itself sent.
 *
 * Without this the Security panel's only source of truth is a 5s poll, which is
 * why HA's own UI felt instant and the CMS did not: HA pushes over a websocket,
 * we were sampling. Same shape as services/casambi-ingest.ts, which does the
 * equivalent job for the lights over MQTT.
 *
 * HA also emits the transient `locking` / `unlocking` states while a command is
 * in flight. Those are forwarded too, so the card can show progress instead of
 * flipping optimistically and appearing to lie for the ~8s a cold Yale command
 * can take.
 */

const RECONNECT_MS = 5_000;
/** HA lock domain states worth forwarding; anything else (e.g. `unavailable`) is passed through as-is. */
const SUBSCRIBE_ID = 1;

/** One Home Assistant state change, as forwarded to listeners. */
export interface HaStateChange {
  entityId: string;
  state: string | null;
  previousState: string | null;
  attributes: Record<string, unknown>;
}

const listeners = new Set<(change: HaStateChange) => void>();

/**
 * Hear every Home Assistant state change (e.g. a motion sensor turning on);
 * returns an unsubscribe. The lock forwarding below is one such use.
 */
export function onHomeAssistantStateChange(listener: (change: HaStateChange) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function wsUrlFrom(httpUrl: string): string {
  return httpUrl.replace(/\/+$/, "").replace(/^http/, "ws") + "/api/websocket";
}

export function startHomeAssistantIngest(): void {
  const url = process.env["HA_URL"];
  const token = process.env["HA_TOKEN"];
  // The lock entity is optional now: motion triggers need only HA_URL/HA_TOKEN.
  const entityId = process.env["HA_ENTITY_ID"];
  if (!url || !token) {
    console.warn("[ha-ingest] disabled — HA_URL/HA_TOKEN not set");
    return;
  }

  let disposed = false;

  const connect = (): void => {
    if (disposed) return;
    const ws = new WebSocket(wsUrlFrom(url));

    const retry = (why: string): void => {
      if (disposed) return;
      console.warn(`[ha-ingest] ${why} — reconnecting in ${RECONNECT_MS}ms`);
      setTimeout(connect, RECONNECT_MS);
    };

    ws.on("message", (raw: WebSocket.RawData) => {
      let msg: {
        type?: string;
        id?: number;
        success?: boolean;
        ha_version?: string;
        event?: {
          data?: {
            entity_id?: string;
            old_state?: { state?: string } | null;
            new_state?: { state?: string; attributes?: Record<string, unknown>; last_changed?: string } | null;
          };
        };
      };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: token }));
        return;
      }
      if (msg.type === "auth_invalid") {
        // A bad token will never fix itself by reconnecting — stop and say so.
        console.error("[ha-ingest] authentication rejected — check HA_TOKEN. Not retrying.");
        disposed = true;
        ws.close();
        return;
      }
      if (msg.type === "auth_ok") {
        console.info(`[ha-ingest] connected → ${url} (HA ${msg.ha_version ?? "?"})`);
        ws.send(JSON.stringify({ id: SUBSCRIBE_ID, type: "subscribe_events", event_type: "state_changed" }));
        return;
      }
      if (msg.type === "result" && msg.id === SUBSCRIBE_ID) {
        if (!msg.success) retry("subscribe_events was rejected");
        else console.info(`[ha-ingest] watching state changes${entityId ? ` (lock: ${entityId})` : ""}`);
        return;
      }

      if (msg.type !== "event") return;
      const data = msg.event?.data;
      if (!data?.entity_id || !data.new_state) return;

      const change: HaStateChange = {
        entityId: data.entity_id,
        state: data.new_state.state ?? null,
        previousState: data.old_state?.state ?? null,
        attributes: data.new_state.attributes ?? {},
      };
      for (const listener of listeners) {
        try {
          listener(change);
        } catch (err) {
          console.error("[ha-ingest] a state-change listener failed:", err);
        }
      }

      if (!entityId || data.entity_id !== entityId) return;

      const next = data.new_state;
      broadcastToCms({
        type: "LOCK_STATE_UPDATE",
        entityId,
        state: next.state ?? "unavailable",
        changedBy: (next.attributes?.["changed_by"] as string | null) ?? null,
        lastChanged: next.last_changed ?? new Date().toISOString(),
      });
    });

    ws.on("close", () => retry("connection closed"));
    ws.on("error", (err: Error) => {
      // 'close' fires right after 'error', so let that one schedule the retry.
      console.error("[ha-ingest] websocket error:", err.message);
    });
  };

  connect();
}
