# Greet on Arrival — Production Rollout Runbook

Companion to [greeting.md](./greeting.md). Written so it can be followed top to bottom. **Nothing here has been run against production** — every command below is for the person doing the rollout.

**Principles**
- The feature is additive and ships **off**. Steps 1–4 change nothing visible.
- The migrations are additive (new tables/column/constraint). Old code ignores them, so they can safely go **before** the new build.
- Rollback is a flag, not a restore.

**What changes on production**

| | |
|---|---|
| Migrations | `0038_ambient_mode` (still unapplied on production per CLAUDE.md), `0039_visitor_greeting`, `0040_visitor_greeting_skipped`, `0041_app_setting` |
| New env (in `.env.production`) | the "Greet on arrival" section of `.env.example` (starts with `GREETING_ENABLED=false`) |
| New build | api + cms images (the CMS carries the TV player and the status badge) |
| Not touched | `services/vision`, `services/voice-agent`, recognition thresholds, `visitor_embedding` |

---

## Step 0 — Before you start

- [ ] A quiet window; the TV and a staff member available for the live checks (Step 7).
- [ ] You are on the production host (or can reach its Docker), **not** a dev laptop whose `.env` points at a local database.
- [ ] The kiosk PC is reachable (for the speech check in Step 6).
- [ ] You know how to deploy normally (`pnpm prod:build` / `pnpm prod:up`, which use `.env.production`).

## Step 1 — Back up (read-only)

```powershell
.\infra\scripts\backup-db.ps1                # writes D:\cms-backups\daily-db\cms_db_<timestamp>.sql from the cms-postgres container
```
Check the printed size is sensible. Keep that file; `infra/scripts/restore-db.ps1` is the way back.

## Step 2 — Read-only pre-checks on production

Run these in `psql` (e.g. `docker exec -it cms-postgres psql -U <user> -d <db>`); they only read.

```sql
-- where migrations stand: expect the newest created_at to be 0037 (1789541393286) or 0038 (1789981662599)
SELECT count(*), max(created_at) FROM public.__drizzle_migrations;

-- is migration 0014's effect present? (it is bookkeeping-only skipped locally too) — expect is_nullable = YES
SELECT is_nullable FROM information_schema.columns WHERE table_name='visitor' AND column_name='embedding';

-- tables the new code expects to exist already
SELECT to_regclass('public.ambient_mode')       AS ambient_mode,       -- NULL until 0038 is applied
       to_regclass('public.visitor')            AS visitor,            -- must exist
       to_regclass('public.visitor_embedding')  AS visitor_embedding,  -- must exist (vision owns it)
       to_regclass('public.visitor_greeting')   AS visitor_greeting,   -- must be NULL now
       to_regclass('public.app_setting')        AS app_setting;        -- must be NULL now

-- the welcome-screen experience (Step 4 needs it)
SELECT id, name, template_key, deleted_at,
       template_content->'welcome'->>'videoUrl' AS video
  FROM experience WHERE slug = 'welcome-screen';
```
Stop and investigate if `visitor`/`visitor_embedding` are missing, or `visitor_greeting`/`app_setting` already exist.

## Step 3 — Apply the migrations: 0038 → 0039 → 0040 → 0041

> **Important:** `packages/db/drizzle.config.ts` **ignores a `DATABASE_URL` set in your shell** — it always loads the repo-root `.env`. So run the migration where that `.env` points at production (the production host), not by exporting a variable. Never run it from a machine whose `.env` is local.

1. **Confirm the target before running anything** (prints host:port/db only):
   ```powershell
   cd packages\db
   pnpm exec tsx -e "const u=new URL(require('./drizzle.config.ts').default.dbCredentials.url); console.log(u.hostname+':'+u.port+u.pathname)"
   ```
   It must show the production database. If it shows `localhost:5433/cms_db_local`, stop.
2. Apply:
   ```powershell
   pnpm --filter @platform/db db:migrate
   ```
   `drizzle-kit migrate` applies, in journal order, everything newer than the last applied migration. The missing *snapshots* for 0038–0041 do **not** matter here (migrate uses only the journal and the `.sql` files; snapshots only matter for `db:generate` — do not run that until the snapshot chain is repaired).
3. **Alternative without drizzle-kit:** the four files in `packages/db/drizzle/` are small and idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`); you can run them with `psql -f` in order. If you do, drizzle's bookkeeping table won't record them, and a later `db:migrate` will simply re-run them harmlessly.
4. **Verify:**
   ```sql
   SELECT count(*), max(created_at) FROM public.__drizzle_migrations;     -- newest = 1792992908836 (0041)
   SELECT column_name FROM information_schema.columns WHERE table_name='visitor_greeting' ORDER BY 1;
        -- expect: greet_date, greeted_at, id, kind, skip_reason, source, visitor_uuid
   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='visitor_greeting_kind_check';
        -- expect: CHECK (kind = ANY (ARRAY['generic','named','skipped']))
   SELECT to_regclass('public.app_setting'), to_regclass('public.ambient_mode');   -- both non-NULL
   ```
   Locks are trivial: a nullable column with no default, a CHECK on an empty table, two new tables.

## Step 4 — Deploy the new build with the flag OFF

1. Open `.env.production` and copy in the "Greet on arrival" section of `.env.example` (every line is a documented default), **leaving `GREETING_ENABLED=false`**. (Not in the compose `environment:` block — it overrides `env_file`.)
2. Build and start as you normally do:
   ```powershell
   pnpm prod:build
   pnpm prod:up
   ```
3. **Verify nothing changed** (this is the "identical to today" proof):
   - [ ] Sign in to the CMS; Screens, Media, Experiences, Visitors load.
   - [ ] Visitors: rename a visitor and merge two test duplicates **or** just open the edit dialog — responses are normal.
   - [ ] The "Welcome Trigger" toggle works; **no** "Greetings" badge is shown in the header.
   - [ ] Walk in front of the camera: with the legacy behaviour the idle `main-screen` still switches to the welcome screen (no auto-revert, as before).
   - [ ] `docker logs cms-api --tail 200` shows **no** `[greeting]` lines.
4. Ambient modes (0038) now work — check the Environment page.

## Step 5 — Verify the welcome experience on production

- [ ] The Step 2 query returned **one** row: `template_key = welcome`, `deleted_at` empty.
- [ ] Its video asset exists on the media volume and plays (open the experience in the CMS and preview it).
- [ ] If there is none: `pnpm --filter @platform/db db:seed-welcome` (run where `.env` points at production, with an admin user present) creates it; then add the video in the Welcome editor.

## Step 6 — Check speech on the kiosk PC (before enabling)

The kiosk app (`tools/main-screen-kiosk`, WebView2) launches with `--autoplay-policy=no-user-gesture-required`, which covers video. Whether it also lets `speechSynthesis` speak without a click is **not verified from the repo**, and the kiosk runs with devtools disabled — so test it directly:

1. On the kiosk PC, open a **normal Edge window** (not the kiosk app), press F12, open Console and run:
   ```js
   speechSynthesis.getVoices().map(v => v.name + ' | ' + v.lang)
   ```
   Note which English voices exist (en-IN needs the *English (India)* Windows language pack with speech installed). WebView2 uses the same local Windows voices; Edge's cloud "Natural" voices are not expected to be available inside it.
2. If you want a specific voice, set `GREETING_VOICE_NAME` to part of its name.
3. The real proof comes in Step 7 from `/api/greeting/status` → `lastTvAck`.

## Step 7 — Enable, restart, live checks

1. In `.env.production` set `GREETING_ENABLED=true` (leave the rest as in the template).
2. Restart **only the API**:
   ```powershell
   docker compose --env-file .env.production -f infra/docker/docker-compose.yml up -d api
   ```
3. `docker logs cms-api --tail 100` must show `[greeting] enabled — tz=Asia/Kolkata voice=screen …` (if absent, the variable did not reach the container — check `.env.production` and `docker exec cms-api printenv GREETING_ENABLED`).
4. The CMS header now shows the **Greetings** badge (green when the TV is connected and armed).
5. Live checks, with a staff member who is a known, named visitor:

| # | Do | Expect |
|---|---|---|
| 1 | Idle screen; staff member walks up | Welcome screen (video **silent**), "Good …, *Name*. Welcome back."; log `greeted …`; after 20 s back to idle |
| 2 | Same person again | Nothing; log `already greeted today` once at most |
| 3 | `GET /api/greeting/status` (as admin) | `lastGreeting` set, `today.greeted` ≥ 1, `lastTvAck.spoke = true` with a voice name. If `spoke:false`, read the reason (Step 6) |
| 4 | Push any video/experience to `main-screen`; a *different* named visitor walks up | Nothing shown/said; log `screen busy (content) — skipped, no greeting today`; they stay skipped for the day |
| 5 | Start a whiteboard on the screen, then a new visitor | Skipped (`whiteboard`); drawing untouched |
| 6 | Stop (blank) the screen with nothing assigned, a new visitor | Screen un-blanks, welcome + greeting, then **re-blanks** |
| 7 | Unplug/close the TV page, a new visitor | `screen offline — not greeted yet`; nothing recorded; reopen the page and they are greeted on the next sighting |
| 8 | Name an unknown visitor who is standing there | "…, *Name*. Nice to meet you." |
| 9 | Toggle "Welcome Trigger" OFF, then restart the API | It stays OFF after the restart (persisted) |
| 10 | Rename someone who left an hour ago | `not in the room — no greeting` |

6. Watch `docker logs cms-api -f` for an hour of normal traffic: there should be roughly one `greeted` line per visitor, no repeating lines, and no `paused for 5 min`.

## Rollback

**Soft (seconds, and the whole answer for almost any problem):**
```
GREETING_ENABLED=false     # in .env.production
docker compose --env-file .env.production -f infra/docker/docker-compose.yml up -d api
```
The system is then identical to before this change: the legacy `PERSON_PRESENT` welcome behaviour returns, PATCH/merge use the original code, no greeting query runs. The new tables stay (harmless, unused). The arm switch reverts to in-memory (armed) behaviour.

**Hard (almost never needed):** redeploy the previous image tag. The migrations are additive and the old code ignores them, so no schema rollback is needed. Only if you must remove them: `DROP TABLE visitor_greeting; DROP TABLE app_setting;` (and the `__drizzle_migrations` rows for 0039–0041 so a later migrate re-applies them). Restoring the Step 1 backup is the last resort and would discard everything since.

## Notes for the person who runs nginx (not changed by this PR)

- The vision service posts to `/api/internal/vision-event`. The API now rejects bodies over 2 MB, but nginx's global `client_max_body_size 1024M` still lets a large request reach the proxy first. Consider a tighter location:
  ```nginx
  location = /api/internal/vision-event {
      client_max_body_size 2m;
      allow <camera host IP>;     # only the machine running services/vision
      deny all;
      proxy_pass http://api_upstream;
  }
  ```
- There is no per-greeting rate limit beyond the existing 600/min/IP on the internal router; sightings are de-duplicated in the service.

## If something looks wrong

| Symptom | First look |
|---|---|
| No `[greeting] enabled` line | the variable isn't in the container (`docker exec cms-api printenv GREETING_ENABLED`) |
| Greeting never happens | `/api/greeting/status`: `armed`, `screen.online`, `breaker` — then the log line table in [greeting.md](./greeting.md#8-troubleshooting-by-log-line) |
| `paused for 5 min: relation … does not exist` | a migration (0039/0040/0041) isn't applied on this database |
| Welcome screen appears but silent | `lastTvAck` in the status — Step 6 |
| Someone is greeted by the wrong name | the recognition matched the wrong person — fix the visitor records in the CMS; set `GREET_NAME_MODE=none` meanwhile |
