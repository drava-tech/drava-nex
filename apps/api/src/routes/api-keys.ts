import { Hono } from "hono";
import { z } from "zod";
import { createApiKey, listApiKeys, revokeApiKey, type ApiKey } from "@platform/db";
import { requireAdmin, type SessionUser } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

export const apiKeysRouter = new Hono();

// All key management is admin-only.
apiKeysRouter.use("*", requireAdmin);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1)).default([]),
  // ISO string or epoch ms; optional.
  expiresAt: z.union([z.string(), z.number()]).optional(),
});

/** Never expose the key hash to clients. */
function maskKey(k: ApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    userId: k.userId,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
  };
}

// GET /api/api-keys — list (masked)
apiKeysRouter.get("/", async (c) => {
  const keys = await listApiKeys();
  return ok(c, keys.map(maskKey));
});

// POST /api/api-keys — create; plaintext returned ONCE
apiKeysRouter.post("/", async (c) => {
  let parsed;
  try {
    parsed = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }

  const expiresAt = parsed.expiresAt !== undefined ? new Date(parsed.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return fail(c, "VALIDATION", "Invalid expiresAt", 400);
  }

  const admin = c.get("user" as never) as SessionUser | undefined;
  const { record, plaintext } = await createApiKey({
    name: parsed.name,
    scopes: parsed.scopes,
    createdByUserId: admin?.id ?? null,
    expiresAt,
  });

  // `key` is the plaintext — shown exactly once, never recoverable later.
  return ok(c, { ...maskKey(record), key: plaintext }, 201);
});

// DELETE /api/api-keys/:id — revoke
apiKeysRouter.delete("/:id", async (c) => {
  await revokeApiKey(c.req.param("id"));
  return ok(c, { revoked: true });
});
