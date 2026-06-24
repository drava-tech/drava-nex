# Database Layer & Connection Setup

This document details the architecture of the database package, schema definitions, and migration workflows.

---

## 1. Database Client Package (`@platform/db`)

The database connection pool and client are wrapped inside the shared workspace package `packages/db`.

- **Connection Pool:** Uses the `pg` Pool client. Max 20 connections, idle timeout 30s, connection timeout 5s.
- **Environment Resolution:** `process.env["DATABASE_URL"]` is checked first. If not set, the client falls back to reading the root workspace `.env` file via a filesystem path crawler:
  ```
  e:\EC\cms-platform\.env   (local dev)
  ```
  In Docker mode, `DATABASE_URL` is injected via `env_file` — the fallback never runs.
- **Docker host:** `postgresql://cms_app:PASSWORD@postgres:5432/cms_db` (`postgres` = Docker service name)
- **Local dev host:** `postgresql://cms_app:PASSWORD@localhost:5432/cms_db`

---

## 2. Health Check

A `checkDatabaseHealth()` function is exported from `packages/db/src/client.ts` and re-exported via `packages/db/src/index.ts`:

```typescript
import { checkDatabaseHealth } from '@platform/db';
const ok = await checkDatabaseHealth(); // true or throws
```

It opens a raw pool connection, runs `SELECT 1`, and releases it. The API health route
(`apps/api/src/index.ts` → `buildHealthPayload`) runs the same `SELECT 1` via Drizzle.

---

## 3. Drizzle Schema

Schema files live in `packages/db/src/schema/` (wired together by `index.ts` + `relations.ts`):

| Table(s) | File | Purpose |
|---|---|---|
| `user`, `session`, `account`, `verification` | `auth.ts` | better-auth identity — admin login + roles |
| `experience` | `projects.ts` | Experiences: `name`, `slug`, the assigned `templateKey` (e.g. `portfolio`, `live-stream`), and per-template content in `templateContent` (JSONB) |
| `media_asset` | `media.ts` | Uploaded media (image/video): `type`, `url`, `name`, size, soft-delete |
| `screen` | `screens.ts` | Displays: `screenId` (PK), `screenName`, `currentContentKind` (`experience`/`media`), FK `currentExperienceId` / `currentMediaAssetId`, `position`, soft-delete `deletedAt` |

**A screen points at exactly one piece of content** (an experience or a media asset). Query
helpers live in `packages/db/src/queries/` — `getScreenContent` (the join that derives the
`WsContent` pushed over the WebSocket), `setScreenExperience`, `setScreenMedia`, `listScreens`,
`listExperiences`, etc. — so apps never write raw SQL.

> Schema evolved via `db:push` plus a few one-off scripts in `packages/db/src/`
> (`migrate-screen.ts`, `migrate-experience-template.ts`, `migrate-media.ts`) and seeds
> (`seed-screens.ts`, `seed-projects.ts`).

---

## 4. Configuration & Migration Setup

- **`drizzle.config.ts`** at `packages/db/`:
  - dialect: `postgresql`
  - schema: `./dist/schema/index.js` (compiled output)
  - out: `./drizzle` (SQL migration files)
  - Migration table: `__drizzle_migrations` in `public` schema
  - Strict mode + verbose logging enabled

**Workflow (local dev):**
```powershell
pnpm db:generate   # generate SQL from schema changes
pnpm db:migrate    # apply pending migrations
pnpm db:push       # push schema directly (dev shortcut, skips migration files)
pnpm db:studio     # open Drizzle Studio browser UI
```

**Workflow (Docker — first boot):**
```bash
docker exec cms-api sh -c "pnpm --filter @platform/db db:push"
```

All `db:*` root scripts delegate to `pnpm --filter @platform/db <script>`.

---

## 5. API Guard

`apps/api/src/index.ts` exits immediately with a clear message if `DATABASE_URL` is missing after startup:

```
[FATAL] DATABASE_URL is not set. Add it to your root .env file and restart.
```
