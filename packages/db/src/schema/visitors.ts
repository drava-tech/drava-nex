import {
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  vector,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

// Postgres `bytea` — drizzle-orm has no built-in type for it. Maps to a Node
// Buffer in/out (the pg driver returns bytea as a Buffer).
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ─── Visitor ──────────────────────────────────────────────────────────────────

/**
 * A person the entrance camera has seen, identified by a 512-d ArcFace
 * embedding matched with pgvector cosine distance. Deliberately separate from
 * the Better Auth `user` table: visitors are enrolled anonymously (blank
 * name/email would violate that table's unique email index) and carry
 * biometric columns Better Auth must not own. The face-vision Python service
 * writes rows directly; the CMS fills in name/email later.
 *
 * Face crops are stored in the database (not on disk): `imageBytes` holds the
 * representative/primary JPEG served by GET /api/visitors/:uuid/image, and the
 * full set of per-angle crops lives on `visitor_embedding.image_bytes` (the
 * additive table the face service owns). `imagePath` is retained only as a
 * lightweight non-null presence marker (it drives `hasImage`); it no longer
 * points at a real file. `imageBytes` is deliberately never selected in list
 * queries — only by the single-image accessor.
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
    // Representative/primary face crop (JPEG bytes). Nullable; never selected
    // in list queries — only by getVisitorImage().
    imageBytes: bytea("image_bytes"),
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
