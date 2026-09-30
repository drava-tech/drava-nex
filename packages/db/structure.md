# packages/db — Database Package

> **Package name:** `@platform/db`
> **Purpose:** the Postgres access layer — Drizzle client, schema, queries
> **Depends on:** `drizzle-orm` · `pg` · `@platform/types`
> **Used by:** `apps/api` (and CMS server actions / route handlers)

---

## What Lives Here

```
packages/db/src/
├── client.ts              → pg Pool + drizzle() client; loads root .env DATABASE_URL
├── index.ts               → re-exports client + schema + all query helpers
├── schema/
│   ├── auth.ts            → better-auth tables (user, session, account, verification)
│   ├── projects.ts        → experience table (name, slug, templateKey, templateContent)
│   ├── media.ts           → media_asset table
│   ├── screens.ts         → screen table (currentExperienceId / currentMediaAssetId, …)
│   ├── relations.ts       → FK relations    └── index.ts → barrel
├── queries/
│   ├── screens.ts         → getScreenContent, setScreenExperience/Media, list/create/delete
│   ├── experiences.ts     → listExperiences …
│   └── media.ts           → media queries
├── migrate-screen.ts / migrate-experience-template.ts / migrate-media.ts  → one-off DDL
└── seed-screens.ts / seed-projects.ts                                    → seeds/utilities
```

Builds to `dist/`; `drizzle.config.ts` points at the compiled schema.

---

## What This Package Does

The **only** place that talks to PostgreSQL — apps import query helpers, never raw SQL or `pg`.

```
apps/api / CMS server actions ──► @platform/db ──► PostgreSQL :5432
```

The central query is **`getScreenContent(screenId)`** — it joins `screen` → `experience`
(or `media_asset`) and returns the `WsContent` shape the gateway broadcasts. Because content
is a *join* (not a frozen copy), renaming/editing an experience reflects on screens live.

---

## Schema (tables)

`user/session/account/verification` (auth) · `experience` (`templateKey` + `templateContent`
JSONB) · `media_asset` · `screen` (points at one experience **or** one media asset). See
[`.doc/database.md`](../../.doc/database.md) for columns + migration workflow.

---

## Scripts (run from root, delegate here)

```
pnpm db:generate / db:migrate / db:push / db:studio
pnpm --filter @platform/db db:seed-screens   # idempotent screen seeding
```
DB connections from the host use `localhost:5432` (published); inside Docker, `postgres:5432`.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| → imports | `@platform/types` | `WsContent` and shared shapes |
| ← imported by | `apps/api` | every DB read/write + the gateway's content lookups |
| ← imported by | `apps/cms` | server actions / route handlers |
| → connects to | PostgreSQL `:5432` | `pg` pool |
