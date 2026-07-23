import { eq, or, ilike, desc, count } from "drizzle-orm";
import type { CreateVisitorInput, ListVisitorsQuery, UpdateVisitorInput } from "@platform/types";
import { db } from "../client.js";
import { visitor, type Visitor } from "../schema/visitors.js";

/**
 * Visitor data access — profiles enrolled by the face-vision service.
 * The Python service writes rows directly over psycopg (enroll / last_seen);
 * these queries serve the Hono API and the CMS admin views. The embedding
 * column is intentionally never selected here — it is only meaningful to the
 * pgvector nearest-neighbor search inside the face service.
 */

// ─── Errors ───────────────────────────────────────────────────────────────────

export class VisitorNotFoundError extends Error {
  constructor(message = "Visitor not found") {
    super(message);
    this.name = "VisitorNotFoundError";
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface VisitorRow {
  uuid: string;
  name: string;
  email: string;
  role: string;
  imagePath: string | null;
  photoUrl: string | null;
  userId: string | null;
  firstSeen: Date;
  lastSeen: Date;
}

export interface VisitorListResult {
  items: VisitorRow[];
  total: number;
  page: number;
  pageSize: number;
}

const visitorColumns = {
  uuid: visitor.uuid,
  name: visitor.name,
  email: visitor.email,
  role: visitor.role,
  imagePath: visitor.imagePath,
  photoUrl: visitor.photoUrl,
  userId: visitor.userId,
  firstSeen: visitor.firstSeen,
  lastSeen: visitor.lastSeen,
};

export async function listVisitors(query: ListVisitorsQuery): Promise<VisitorListResult> {
  const { page, pageSize, search } = query;

  const where = search
    ? or(ilike(visitor.name, `%${search}%`), ilike(visitor.email, `%${search}%`))
    : undefined;

  const totalRows = await db.select({ total: count() }).from(visitor).where(where);
  const total = totalRows[0]?.total ?? 0;

  const rows = await db
    .select(visitorColumns)
    .from(visitor)
    .where(where)
    .orderBy(desc(visitor.lastSeen))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items: rows, total, page, pageSize };
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function getVisitorByUuid(uuid: string): Promise<VisitorRow | null> {
  const [row] = await db
    .select(visitorColumns)
    .from(visitor)
    .where(eq(visitor.uuid, uuid))
    .limit(1);
  return row ?? null;
}

// ─── Create (staff adds a guest manually — no camera enrollment) ──────────────

/**
 * Inserts a visitor with no face embedding: `embedding` stays NULL, which
 * both the HNSW index and the vision service's nearest-neighbor query treat
 * as "never a match" (see schema comment on `visitor.embedding`). Role is
 * hardcoded to "guest", same invariant as updateVisitorContact. `photoUrl`
 * (if provided) is a public media-library URL, never the biometric `imagePath`.
 */
export async function createManualVisitor(input: CreateVisitorInput): Promise<VisitorRow> {
  const [row] = await db
    .insert(visitor)
    .values({
      name: input.name,
      email: input.email ?? "",
      photoUrl: input.photoUrl || null,
    })
    .returning(visitorColumns);
  if (!row) throw new Error("Failed to create visitor.");
  return row;
}

// ─── Update (staff assigns name/email; role stays "guest") ────────────────────

export async function updateVisitorContact(
  uuid: string,
  input: UpdateVisitorInput
): Promise<VisitorRow> {
  const patch: Partial<Pick<Visitor, "name" | "email">> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.email !== undefined) patch.email = input.email;

  const [row] = await db
    .update(visitor)
    .set(patch)
    .where(eq(visitor.uuid, uuid))
    .returning(visitorColumns);
  if (!row) throw new VisitorNotFoundError();
  return row;
}
