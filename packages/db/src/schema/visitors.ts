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
    embedding: vector("embedding", { dimensions: 512 }).notNull(),
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
