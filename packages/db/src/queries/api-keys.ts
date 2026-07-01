import { createHash, randomBytes } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../client.js";
import { apiKey, type ApiKey } from "../schema/api-keys.js";

// Plaintext keys look like "ek_<urlsafe-secret>". Only the SHA-256 hash is stored.
const KEY_PREFIX = "ek";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type CreatedApiKey = { record: ApiKey; plaintext: string };

export async function createApiKey(input: {
  name: string;
  scopes: string[];
  createdByUserId?: string | null;
  userId?: string | null;
  expiresAt?: Date | null;
}): Promise<CreatedApiKey> {
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `${KEY_PREFIX}_${secret}`;
  const prefix = plaintext.slice(0, 11); // "ek_" + first 8 secret chars
  const [record] = await db
    .insert(apiKey)
    .values({
      name: input.name,
      prefix,
      keyHash: hashKey(plaintext),
      scopes: input.scopes,
      createdByUserId: input.createdByUserId ?? null,
      userId: input.userId ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!record) throw new Error("Failed to create API key");
  return { record, plaintext };
}

/** All keys, newest first. Hashes are present on the row but routes should mask them. */
export async function listApiKeys(): Promise<ApiKey[]> {
  return db.select().from(apiKey).orderBy(desc(apiKey.createdAt));
}

export async function revokeApiKey(id: string): Promise<void> {
  await db
    .update(apiKey)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(apiKey.id, id));
}

export type VerifiedApiKey = {
  id: string;
  name: string;
  scopes: string[];
  userId: string | null;
};

/** Resolve a plaintext key to its record if valid (not revoked, not expired). */
export async function verifyApiKey(raw: string): Promise<VerifiedApiKey | null> {
  if (!raw) return null;
  const [row] = await db
    .select()
    .from(apiKey)
    .where(eq(apiKey.keyHash, hashKey(raw)))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  // Fire-and-forget last-used stamp; never block or fail the request on it.
  void (async () => {
    try {
      await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, row.id));
    } catch {
      /* best-effort */
    }
  })();

  return { id: row.id, name: row.name, scopes: row.scopes ?? [], userId: row.userId };
}

/** Does a key's granted scopes satisfy `required`? Supports "*" and "ns:*" wildcards. */
export function scopeSatisfies(granted: string[], required: string): boolean {
  if (granted.includes("*") || granted.includes(required)) return true;
  const ns = required.split(":")[0];
  return granted.includes(`${ns}:*`);
}
