import {
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  vector,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

// ─── Visitor ──────────────────────────────────────────────────────────────────

/**
 * A person the entrance camera has seen, identified by a 512-d ArcFace
 * embedding matched with pgvector cosine distance. Deliberately separate from
 * the Better Auth `user` table: visitors are enrolled anonymously (blank
 * name/email would violate that table's unique email index) and carry
 * biometric columns Better Auth must not own. The face-vision Python service
 * writes rows directly; the CMS fills in name/email later.
 *
 * `imagePath` is the bare JPEG filename inside FACE_IMAGE_DIR (never an
 * absolute path); the purge script sets it to NULL after the retention window
 * while keeping the embedding, so recognition keeps working anonymously.
 *
 * `embedding` is nullable: rows the face-vision service enrolls always carry
 * one, but staff can also add a guest manually from the CMS with no camera
 * scan — those rows have `embedding = NULL` and are never enrolled in face
 * matching. The HNSW index and `matcher.py`'s nearest-neighbor query both
 * naturally skip/deprioritize NULLs, so this needs no query changes there.
 *
 * `photoUrl` is a display photo staff pick from the general media library for
 * a manually-added guest (a public `/media/...` URL, same as any other CMS
 * asset). Deliberately a separate column from `imagePath`: that one is a bare
 * filename resolved only inside FACE_IMAGE_DIR and streamed through an
 * admin-gated route because it is biometric PII — `photoUrl` must never be
 * confused with it or fed into that path-containment logic.
 */
export const visitor = pgTable(
  "visitor",
  {
    id: serial("id").primaryKey(),
    uuid: uuid("uuid").notNull().defaultRandom(),
    name: text("name").notNull().default(""),
    email: text("email").notNull().default(""),
    role: text("role").notNull().default("guest"),
    imagePath: text("image_path"),
    photoUrl: text("photo_url"),
    embedding: vector("embedding", { dimensions: 512 }),
    // Optional link to a real CMS/auth account (e.g. an employee), set by staff.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    firstSeen: timestamp("first_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("visitor_uuid_unique_idx").on(table.uuid),
    index("visitor_last_seen_idx").on(table.lastSeen),
    index("visitor_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

export type Visitor = typeof visitor.$inferSelect;
export type NewVisitor = typeof visitor.$inferInsert;
