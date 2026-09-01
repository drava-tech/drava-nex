# Common Development Workflows

Five named task patterns covering the most frequent work in this repo.

---

## 1. Start the Full Stack

**Goal:** Get all three servers and backing services running locally.

```bash
pnpm infra:up          # starts Postgres, Mosquitto, Nginx in Docker
pnpm dev               # starts CMS (3000), Screens (3001), API (4000) via Turborepo
```

**Verify health:**
```bash
curl http://localhost:4000/health   # direct API — must return {"status":"ok"}
curl http://localhost/api/health    # through Nginx — must also return {"status":"ok"}
pnpm healthcheck                    # same as the Nginx check above
```

If the direct check passes but Nginx fails: check `infra/nginx/default.conf` routing.
If both fail: check `.env` is populated from `.env.example` and Postgres is up.

**Skills:** `/run`, `/verify`

---

## 2. Add or Change an API Route

**Goal:** Add or modify a route in the Hono API and confirm it works end-to-end.

1. Edit `apps/api/src/index.ts` (or the appropriate route file)
2. Check that request/response types come from `@platform/types` — do not define types inline
3. Run `pnpm typecheck` to confirm no TS errors across the monorepo
4. Verify the route via both paths:
   ```bash
   curl http://localhost:4000/your-route      # direct
   curl http://localhost/api/your-route       # through Nginx
   ```
5. Run `/code-review` on the diff before committing

**Key rules for Hono (see [skills/hono.md](skills/hono.md)):**
- Write handlers inline after path definitions, not in separate controller files
- Use validation middleware (not hooks) for request validation
- Always `await next()` in middleware

**Skills:** `/code-review`, `/verify`

---

## 3. DB Schema Change

**Goal:** Add a table, column, or relation to the Drizzle schema and apply it.

1. Edit the relevant file in `packages/db/src/schema/`
2. Generate the migration:
   ```bash
   pnpm db:generate
   ```
3. Apply to local DB:
   ```bash
   pnpm db:push          # local dev — fast, no migration file needed
   # OR
   pnpm db:migrate       # production — runs the generated migration SQL
   ```
4. Verify the API health endpoint still reports `"database":"ok"`
5. Update any affected TypeScript types in `@platform/types` if the shape changed

**Key rules for Drizzle (see [skills/drizzle.md](skills/drizzle.md)):**
- Always run `db:generate` after schema changes — never edit migration SQL manually
- Use `db:push` in dev, `db:migrate` in production
- Use `typeof table.$inferSelect` for TypeScript types — do not hand-write them

**Skills:** `/verify`

---

## 4. Onboard a New Session / Create CLAUDE.md

**Goal:** Give a new Claude Code session (or any agent) full context about the repo.

1. Run `/init` — point it at:
   - `.doc/` — detailed documentation folder
   - `structure.md` files in each app and package
   - This `.agent/` folder itself
2. Review the generated `CLAUDE.md` against `AGENTS.md` (currently empty — fill it in)
3. Update `.agent/context.md` if project state has changed since last session

**Skills:** `/init`

---

## 5. Pre-Commit Review

**Goal:** Ensure changes are correct and safe before committing.

1. Run the type and lint checks:
   ```bash
   pnpm typecheck
   pnpm lint
   ```
2. Run `/code-review` at medium effort on the diff
3. If the diff touches any of these, also run `/security-review`:
   - `.env` handling or `process.env` access
   - CORS configuration in `apps/api/src/index.ts`
   - Auth headers, API keys, or secrets
   - Nginx proxy config in `infra/nginx/default.conf`

**Skills:** `/code-review`, `/security-review`
