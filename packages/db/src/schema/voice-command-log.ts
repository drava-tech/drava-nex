import { pgTable, text, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row per command TRAVIS (the room-mic voice agent) issues through
 * /api/internal/voice/*. Records what was done and what the CMS decided,
 * not who spoke — there is no speaker identification in this deployment, so
 * "who" cannot honestly be more specific than "voice" (see the source
 * comparison on `screenControl`/`deviceControl`: nothing button-driven
 * writes here). Written by apps/api/src/routes/voice-internal.ts only.
 */
export const voiceCommandLog = pgTable(
  "voice_command_log",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    // 'device_control' | 'screen_control'
    tool: text("tool").notNull(),
    // e.g. 'lights_on' | 'lock' | 'assign_experience' | 'blank'
    action: text("action").notNull(),
    // Spoken device/screen name as given, before name resolution.
    target: text("target"),
    // Spoken experience/media name, for screen_control's content-assigning actions.
    content: text("content"),
    params: jsonb("params").$type<Record<string, unknown>>(),
    success: boolean("success").notNull(),
    // The result message spoken back — including CMS-side clarification
    // questions ("Which device did you mean?") and error text on failure.
    message: text("message").notNull(),
    // Structured VoiceActionError code ('FORBIDDEN_SCOPE', 'AMBIGUOUS_TARGET',
    // 'NOT_FOUND', ...) or 'OK' on success — lets an audit query filter by
    // failure category instead of matching free-text message strings.
    code: text("code"),
    // Groups every command from one continuous wake-to-sleep interaction —
    // generated once per Gemini Live connection by the voice agent and sent
    // on every call in that session, so a shared room mic's history can be
    // reconstructed as distinct conversations instead of one flat list.
    sessionId: text("session_id"),
    // True when this row is a replay of an already-logged success (the
    // client retried after a network blip and the server served the cached
    // result instead of re-actuating) rather than a fresh execution.
    wasReplay: boolean("was_replay").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("voice_command_log_created_at_idx").on(table.createdAt),
    index("voice_command_log_session_id_idx").on(table.sessionId),
  ]
);

export type VoiceCommandLog = typeof voiceCommandLog.$inferSelect;
export type NewVoiceCommandLog = typeof voiceCommandLog.$inferInsert;
