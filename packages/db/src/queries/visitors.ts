import { eq, or, ilike, desc, count } from "drizzle-orm";
import type { ListVisitorsQuery, UpdateVisitorInput } from "@platform/types";
import { db, pool } from "../client.js";
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

export class InvalidVisitorMergeError extends Error {
  constructor(message = "A visitor cannot be merged into itself") {
    super(message);
    this.name = "InvalidVisitorMergeError";
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface VisitorRow {
  uuid: string;
  name: string;
  email: string;
  role: string;
  imagePath: string | null;
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

// ─── Image (bytes, served by the admin image route) ───────────────────────────

/**
 * The visitor's representative face crop as raw JPEG bytes, or null when the
 * visitor doesn't exist or has no stored image. Kept separate from the row
 * queries so the bytea column is never pulled into list/detail results.
 */
export async function getVisitorImage(uuid: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ imageBytes: visitor.imageBytes })
    .from(visitor)
    .where(eq(visitor.uuid, uuid))
    .limit(1);
  return row?.imageBytes ?? null;
}

// ─── Captured photos (per-angle samples on visitor_embedding) ─────────────────
// visitor_embedding is the face service's own table (not in the Drizzle schema),
// so these use raw pool queries.

/** photo_numbers of a visitor's stored crops, ascending. */
export async function listVisitorPhotos(uuid: string): Promise<number[]> {
  const { rows } = await pool.query<{ photo_number: number }>(
    "SELECT photo_number FROM visitor_embedding WHERE visitor_uuid = $1 AND image_bytes IS NOT NULL ORDER BY photo_number",
    [uuid]
  );
  return rows.map((r) => r.photo_number);
}

/** One captured crop's JPEG bytes, or null. */
export async function getVisitorPhoto(uuid: string, photoNumber: number): Promise<Buffer | null> {
  const { rows } = await pool.query<{ image_bytes: Buffer | null }>(
    "SELECT image_bytes FROM visitor_embedding WHERE visitor_uuid = $1 AND photo_number = $2 LIMIT 1",
    [uuid, photoNumber]
  );
  return rows[0]?.image_bytes ?? null;
}

/**
 * Delete one captured crop (and its embedding sample), then keep the visitor's
 * representative thumbnail valid: re-point visitor.image_bytes to the lowest
 * remaining crop, or clear image_bytes + image_path (→ hasImage false) if none
 * are left.
 */
export async function deleteVisitorPhoto(uuid: string, photoNumber: number): Promise<void> {
  await pool.query("DELETE FROM visitor_embedding WHERE visitor_uuid = $1 AND photo_number = $2", [
    uuid,
    photoNumber,
  ]);
  await pool.query(
    `UPDATE visitor SET
       image_bytes = (SELECT image_bytes FROM visitor_embedding
                      WHERE visitor_uuid = $1 AND image_bytes IS NOT NULL
                      ORDER BY photo_number LIMIT 1),
       image_path = CASE WHEN EXISTS (SELECT 1 FROM visitor_embedding
                      WHERE visitor_uuid = $1 AND image_bytes IS NOT NULL)
                      THEN image_path ELSE NULL END
     WHERE uuid = $1`,
    [uuid]
  );
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

export interface VisitorUpdateResult {
  visitor: VisitorRow;
  /** The name as it was immediately before this update (locked, so it can't race). */
  previousName: string;
}

/**
 * Same update as updateVisitorContact, but it also reports the previous name.
 * Only used when greetings are enabled; with them off the route calls the plain
 * single UPDATE above. The old name is read under a row lock in the same
 * transaction, so two concurrent edits can't both observe "was blank" — the
 * unknown -> named transition is seen exactly once. It locks a single visitor
 * row and takes no second lock while holding it, so it cannot form a lock
 * cycle with mergeVisitor.
 */
export async function updateVisitorContactWithPrevious(
  uuid: string,
  input: UpdateVisitorInput
): Promise<VisitorUpdateResult> {
  const patch: Partial<Pick<Visitor, "name" | "email">> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.email !== undefined) patch.email = input.email;

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: visitor.name })
      .from(visitor)
      .where(eq(visitor.uuid, uuid))
      .for("update")
      .limit(1);
    if (!before) throw new VisitorNotFoundError();

    const [row] = await tx
      .update(visitor)
      .set(patch)
      .where(eq(visitor.uuid, uuid))
      .returning(visitorColumns);
    if (!row) throw new VisitorNotFoundError();
    return { visitor: row, previousName: before.name };
  });
}

/** Move one face identity into another while preserving both identities' samples. */
export async function mergeVisitor(sourceUuid: string, targetUuid: string): Promise<VisitorRow> {
  if (sourceUuid === targetUuid) throw new InvalidVisitorMergeError();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{
      uuid: string;
      name: string;
      email: string;
      role: string;
      imagePath: string | null;
      userId: string | null;
      imageBytes: Buffer | null;
      firstSeen: Date;
      lastSeen: Date;
    }>(
      `SELECT uuid, name, email, role, image_path AS "imagePath", user_id AS "userId",
              image_bytes AS "imageBytes", first_seen AS "firstSeen", last_seen AS "lastSeen"
         FROM visitor
        WHERE uuid IN ($1, $2)
        FOR UPDATE`,
      [sourceUuid, targetUuid]
    );
    const source = rows.find((row) => row.uuid === sourceUuid);
    const target = rows.find((row) => row.uuid === targetUuid);
    if (!source || !target) throw new VisitorNotFoundError("Source or target visitor not found");

    const maxPhoto = await client.query<{ max: number | null }>(
      "SELECT MAX(photo_number) AS max FROM visitor_embedding WHERE visitor_uuid = $1",
      [targetUuid]
    );
    const photoOffset = maxPhoto.rows[0]?.max ?? 0;
    await client.query(
      `WITH source_rows AS (
         SELECT id, row_number() OVER (ORDER BY id) AS sequence
           FROM visitor_embedding
          WHERE visitor_uuid = $1
       )
       UPDATE visitor_embedding AS embedding
          SET visitor_uuid = $2,
              photo_number = $3 + source_rows.sequence
         FROM source_rows
        WHERE embedding.id = source_rows.id`,
      [sourceUuid, targetUuid, photoOffset]
    );

    const mergedResult = await client.query<VisitorRow>(
      `UPDATE visitor
          SET name = CASE WHEN visitor.name = '' THEN source.name ELSE visitor.name END,
              email = CASE WHEN visitor.email = '' THEN source.email ELSE visitor.email END,
              image_path = COALESCE(visitor.image_path, source.image_path),
              image_bytes = COALESCE(visitor.image_bytes, source.image_bytes),
              first_seen = LEAST(visitor.first_seen, source.first_seen),
              last_seen = GREATEST(visitor.last_seen, source.last_seen)
         FROM visitor AS source
        WHERE visitor.uuid = $1 AND source.uuid = $2
      RETURNING visitor.uuid, visitor.name, visitor.email, visitor.role,
                visitor.image_path AS "imagePath", visitor.user_id AS "userId",
                visitor.first_seen AS "firstSeen", visitor.last_seen AS "lastSeen"`,
      [targetUuid, sourceUuid]
    );
    await client.query("DELETE FROM visitor WHERE uuid = $1", [sourceUuid]);
    await client.query("COMMIT");
    if (!mergedResult.rows[0]) throw new VisitorNotFoundError();
    return mergedResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
