import { desc, count } from "drizzle-orm";
import { db } from "../client.js";
import { voiceCommandLog, type VoiceCommandLog } from "../schema/voice-command-log.js";

/**
 * Voice command history — one row per TRAVIS-issued command. See
 * apps/api/src/routes/voice-internal.ts, which is the only writer.
 */

export interface RecordVoiceCommandInput {
  tool: string;
  action: string;
  target?: string | null;
  content?: string | null;
  params?: Record<string, unknown> | null;
  success: boolean;
  message: string;
  code?: string | null;
  sessionId?: string | null;
  wasReplay?: boolean;
}

export async function recordVoiceCommand(input: RecordVoiceCommandInput): Promise<VoiceCommandLog> {
  const [row] = await db.insert(voiceCommandLog).values(input).returning();
  if (!row) throw new Error("Failed to record voice command log");
  return row;
}

export interface VoiceCommandLogListResult {
  items: VoiceCommandLog[];
  total: number;
}

export async function listVoiceCommandLog(limit = 50): Promise<VoiceCommandLogListResult> {
  const totalRows = await db.select({ total: count() }).from(voiceCommandLog);
  const total = totalRows[0]?.total ?? 0;

  const items = await db
    .select()
    .from(voiceCommandLog)
    .orderBy(desc(voiceCommandLog.createdAt))
    .limit(limit);

  return { items, total };
}
