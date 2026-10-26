# Greet on Arrival

When the entrance camera recognises a visitor, `main-screen` briefly shows the **Welcome** experience and the TV says a greeting ("Good afternoon, Priya. Welcome back."). Each visitor is greeted at most once per local day.

It is **off by default** (`GREETING_ENABLED=false`). With it off, nothing from this feature is loaded or run and the system behaves exactly as it did before.

- Rollout and rollback: [greeting-rollout.md](./greeting-rollout.md)
- Environment variables: the table below (and the "Greet on arrival" section of `.env.example`, which is the template to copy into `.env.production`)

---

## 1. What it does

| Situation | Result |
|---|---|
| Named visitor, first arrival today | Welcome screen + "Good *morning/afternoon/evening*, *Name*. Welcome back." (or "Welcome." if their `first_seen` is today) |
| Several people within 3 s | One screen, one line: "…, Priya and Arjun. Welcome back." ("Welcome back." only if **everyone** is returning; more than 4 names becomes "everyone") |
| Unknown visitor (no name) | `GREET_UNKNOWN`: `screen` = welcome screen, silent · `generic` = "Good afternoon. Welcome." · `off` = nothing |
| Host names an unknown visitor who is in the room | "…, *Name*. Nice to meet you." (at most once per day) |
| Unknown face merged into a named person who is in the room | Arrival wording ("Welcome back.") |
| Already greeted today | Nothing — and it is never repeated, including after an API restart |
| Screen busy (live whiteboard, blanked over content, any content other than the default media) | Nothing shown or said; visitor recorded as **skipped** — no greeting for them for the rest of the day |
| No TV connected | Nothing shown, said **or recorded** — the next sighting tries again |
| Sighting is old (replayed event, or `last_seen` more than ~60 s ago) | Ignored |
| Welcome screen already showing | The new line is spoken; no re-push; the revert timer is **not** restarted |
| After `WELCOME_SCREEN_DURATION_SECONDS` (20) | Back to what was showing before (idle, or blanked) — only if the welcome screen is still what is assigned |

"Today" is the local day in `GREETING_TZ` (default `Asia/Kolkata`), never the server's own timezone.

### The welcome video's sound
The API marks the welcome content `muted: true, narrate: false` while greetings are on (override with `WELCOME_VIDEO_MUTED`). The TV just obeys; it has no setting of its own. The "Turn on sound" button is hidden for a muted welcome video.

### What is said aloud
- Names come only from `visitor.name` in the database — never from an event payload.
- Control characters are stripped, the name is capped at 40 characters, and placeholders (`unknown`, `test`, `guest`, `visitor`, `n/a`, `Unknown-1a2b3c4d` …) are treated as an unknown visitor. A name that merely *contains* such a word ("Priya Test") is fine.
- `GREET_NAME_MODE`: `full` (as entered) · `first` (first word) · `none` (never a name).

---

## 2. Architecture

```
 entrance camera
      │
      ▼
 services/vision  ── match, vote across ≥3 good frames, touch() writes visitor.last_seen
      │            (touch is rate-limited to once per 30 s per visitor)
      │  POST /api/internal/vision-event     x-broadcast-secret · 2 MB body limit · 600/min/IP
      ▼
 routes/internal.ts ──────────────► CMS WebSocket (VISITOR_DETECTED, always)
      │  GREETING_ENABLED + valid uuid
      │     armed?  no → "[greeting] disarmed …" (logged at most every 10 min)
      ▼
 GreetingService.onVisitorDetected(uuid, eventLastSeen)
      │  fresh? (event timestamp + DB last_seen)      stale → ignored, logged once / 5 min
      │  cached for today?                            yes   → silent
      │  queue in a 3 s batch (joins don't extend the window)
      ▼  flush
 ScreenController.present()   — one serialised step, ONE database read
      │
      ├─ offline (no real player) ───► onOffline: nothing shown/said/recorded
      ├─ busy ───────────────────────► GreetingService.handleBusy ► 'skipped' row (+ reason)
      └─ idle / blanked-idle / welcome already showing
             │
             ▼  GreetingService.admit  — the DAILY GATE (visitor_greeting upsert, atomic)
             │     already greeted → nothing
             ▼
        idle: push welcome-screen (clearing a Stop overlay first), snapshot, start 20 s timer
             │
             ▼  voice.speak → GREET (transient SCREEN_COMMAND) ► every socket of the screen
        TV player ► speechSynthesis ► GREET_ACK {spoke, voice, error} ► API (shown in /status)
             │
             ▼  20 s: revert to the snapshot (idle, or re-blank) — unless something else was
                assigned (then nothing), or a whiteboard is live (then a watch waits for it to end)
```

### Where the code is

| Area | Files |
|---|---|
| Rules (gate, freshness, names, logs) | `apps/api/src/services/greeting/service.ts` |
| Screen decisions, timer, snapshot, whiteboard watch | `…/greeting/screen.ts` |
| Wording, day/part-of-day, name safety | `…/greeting/text.ts` |
| Config | `…/greeting/config.ts` · `apps/api/src/lib/greeting-flag.ts` |
| Batching · voice adapters | `…/greeting/batcher.ts` · `…/greeting/voice.ts` |
| Wiring, status, arm persistence, purge | `…/greeting/index.ts` |
| Welcome video policy (muted/narrate) | `apps/api/src/lib/welcome-policy.ts`, `lib/screen-content.ts` |
| Routes | `routes/internal.ts` (trigger) · `routes/visitors.ts` (rename/merge) · `routes/greeting.ts` (status) · `routes/vision-trigger.ts` (arm) |
| TV | `apps/cms/.../LiveScreenPlayer.tsx` (GREET + ack) · `packages/ui/src/lib/greeting.ts` · `welcome-renderer.tsx` |
| DB | `packages/db/src/schema/visitor-greeting.ts`, `app-setting.ts` · `queries/visitor-greetings.ts`, `app-settings.ts` · migrations 0039–0041 |

### The flag-off guarantee
With `GREETING_ENABLED` off: `PERSON_PRESENT` runs the original `showWelcomeScreenIfIdle` (no revert timer); PATCH/merge use the original single `UPDATE`; boot is the plain `resetAllScreensToIdle()`; the arm switch is in-memory only; no greeting code is imported and no `visitor_greeting`/`app_setting` query is made. The API only adds a body-size limit on the internal route and a `GREET_ACK` message handler that is never used.

---

## 3. Screen states

The screen is classified from one row (see `getScreenGreetingState`), in this order:

| # | State | Meaning | Greeting |
|---|---|---|---|
| 1 | offline | No real (non-preview) player connected | nothing, not recorded |
| 2 | busy: whiteboard | a whiteboard is active on the screen row or being pushed | skipped |
| 3 | welcome / busy: blanked | welcome assigned; if Stop is on it is "blanked" | speak only / skipped |
| 4 | idle | nothing assigned, **or** the screen's default media is what is playing (same rule as `isScreenIdle`) | push + speak |
| 5 | busy: blanked / content | Stop over content, or anything else assigned | skipped |

*Idle but blanked* is idle: the Stop overlay is cleared the way the operator routes do, the welcome screen is shown, and the revert **re-blanks** it.

---

## 4. Database

`visitor_greeting` — one row per visitor per local day (`UNIQUE (visitor_uuid, greet_date)`, `ON DELETE CASCADE`).

| `kind` | Meaning |
|---|---|
| `generic` | greeted while unknown (no name said) |
| `named` | greeted by name. A rename/merge/arrival upgrades `generic` → `named`, never the reverse |
| `skipped` | **not a greeting** — the screen was busy. Blocks arrival, rename and merge for the day. Written only if the visitor has no row yet, so it never overwrites an earlier greeting. `skip_reason` = `whiteboard` / `blanked` / `content` |

`source` = `arrival` / `rename` / `merge`. A CHECK constraint limits `kind`.

`app_setting(key, value)` — currently one key, `vision_trigger_armed`.

Retention: rows older than `GREETING_RETENTION_DAYS` are deleted once a day (hourly check) while greetings are on.

---

## 5. Environment variables

All are read by the **api** container. In production put them in `.env.production` (never in the compose `environment:` block).

| Variable | Default | Valid values / notes |
|---|---|---|
| `GREETING_ENABLED` | `false` | `1`/`true`/`yes`/`on` enable; anything else (including typos) is off |
| `GREETING_TZ` | `Asia/Kolkata` | IANA name; invalid → default + warning |
| `GREET_UNKNOWN` | `screen` | `screen` · `generic` · `off` |
| `GREETING_VOICE` | `screen` | `screen` (the TV speaks) · `off` (log only) · `travis` (stub: logs "not implemented") |
| `GREETING_VOICE_NAME` | unset | exact or partial `speechSynthesis` voice name; falls back to en-IN, then any English |
| `GREET_NAME_MODE` | `full` | `full` · `first` · `none` |
| `GREET_BATCH_WINDOW_MS` | `3000` | 0–60000; 0 = no grouping |
| `GREET_MAX_NAMES` | `4` | 1–20; more → "everyone" |
| `GREET_PRESENCE_WINDOW_SECONDS` | `120` | 1–86400; "in the room" for rename/merge |
| `GREET_ARRIVAL_FRESH_SECONDS` | `30` | 1–600; event age limit (DB `last_seen` is allowed this + 30 s) |
| `GREET_AFTERNOON_HOUR` / `GREET_EVENING_HOUR` | `12` / `17` | evening must be after afternoon, else both revert |
| `WELCOME_SCREEN_DURATION_SECONDS` | `20` | 1–3600 |
| `WELCOME_VIDEO_MUTED` | unset | unset = muted while greetings are on, untouched while off; `true`/`false` force it |
| `GREET_BUSY_SKIPS_DAY` | `all` | `all` busy reasons skip the day · `whiteboard` only that (others count as greeted, silently) |
| `GREETING_RETENTION_DAYS` | `30` | 1–3650 |

A bad value logs a warning and falls back to its default; it never stops the API.

---

## 6. Operating it

- **Arm switch** (CMS header, "Welcome Trigger"): disarmed = sightings are ignored. While greetings are on the choice is stored in `app_setting` and survives a restart; if it cannot be read at boot the API starts **disarmed**.
- **Status badge** (CMS header, next to the toggle): green / amber / red dot, today's greeted/skipped counts; hover for detail. Hidden while the feature is off.
- **`GET /api/greeting/status`** (admin): `enabled`, `armed`, config, `screen.online`, today's counts (from the database, so they survive restarts), `lastGreeting`, `counters`, `breaker`, `lastTvAck`.
- **Pause everything**: toggle the switch off, or set `GREETING_ENABLED=false` and restart.

---

## 7. Local testing

**Run the stack with the feature on** (PowerShell, from the repo root):

```powershell
$env:GREETING_ENABLED="true"; $env:GREETING_VOICE="screen"; $env:GREET_UNKNOWN="generic"
$env:MQTT_BROKER_URL="mqtt://localhost:1883"; $env:HA_URL=""; $env:HA_TOKEN=""   # keep a local API off the real lights/door
$env:PRE_ENTRY_ON_START="0"; $env:TRAVIS_AUTOSTART="0"
pnpm dev     # apps/api/turbo.json passes these variables through to the API
```

Open the TV page **before** testing: `http://localhost:3000/display/main-screen` (a CMS preview `?preview=1` never counts as a connected player, and never speaks). Click once on the page so Chrome allows speech. A page load resets `main-screen` to idle.

The API's first greeting prints `[greeting] enabled — …`. Then send a sighting:

```powershell
$line = Get-Content .env | Where-Object { $_ -match '^\s*BROADCAST_SECRET\s*=' } | Select-Object -First 1
$secret = ($line -replace '^\s*BROADCAST_SECRET\s*=\s*','').Trim().Trim('"')
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4000/api/internal/vision-event `
  -Headers @{ 'x-broadcast-secret' = $secret } -ContentType 'application/json' `
  -Body (@{ type='VISITOR_DETECTED'; uuid='<visitor uuid>'; name=''; isNew=$false; lastSeen=(Get-Date).ToUniversalTime().ToString('o'); hasImage=$false } | ConvertTo-Json)
```

The visitor's `last_seen` must be recent (the freshness check), e.g. `UPDATE visitor SET last_seen = now() WHERE uuid = '…'`.

**Re-run a test**: delete today's row (`DELETE FROM visitor_greeting WHERE visitor_uuid = '…' AND greet_date = (now() AT TIME ZONE 'Asia/Kolkata')::date`) **and restart the API** (it caches "greeted today").

**Automated**

| Command | What |
|---|---|
| `pnpm --filter @platform/api test` | unit tests (a dead-port `DATABASE_URL` is forced; nothing can reach a database) |
| `pnpm --filter @platform/ui test` | player helpers |
| `pnpm --filter @platform/api test:integration` | real-SQL + whole-chain tests against a **throwaway database on the local Docker Postgres only**. Refuses any host other than localhost:5433. Needs the local stack (`pnpm infra:up`) |

The integration suite clones the *schema* of `cms_db_local` (the committed migrations alone cannot build an empty database — `media_asset` is created out-of-band) and applies 0039–0041 on top; the throwaway database is dropped afterwards.

---

## 8. Troubleshooting by log line

| Log line | Meaning / what to do |
|---|---|
| `[greeting] enabled — tz=… voice=… …` | Startup summary. Check every value. Absent = the flag is not reaching the API (see "Dev" below). |
| `[greeting] greeted "<text>" — <names>` | A greeting was delivered. |
| `[greeting] already greeted today — <who>` | Normal, once per visitor per day. |
| `[greeting] screen busy (<reason>) — skipped, no greeting today — <who>` | Screen was in use (`whiteboard`, `blanked`, `content`). The visitor gets nothing until tomorrow. If common, review what is on `main-screen`. |
| `[greeting] screen busy (<reason>) — skipped (counted as greeted)` | `GREET_BUSY_SKIPS_DAY=whiteboard` and a non-whiteboard reason. |
| `[greeting] screen offline — not greeted yet — <who>` | No real player connected. Is the TV page open (not `?preview=1`)? Retried on the next sighting; logged once per visitor per 5 min. |
| `[greeting] ignored stale sighting (event is Ns old)` | Old/replayed event. If frequent for live sightings, compare the vision host's clock with the API's. |
| `[greeting] ignored stale sighting (not seen in the last Ns)` | Database `last_seen` is old: vision isn't writing it (`VISION_DB_ENABLED=false`?). |
| `[greeting] disarmed (welcome-trigger switch is OFF) — arrivals ignored` | Switch the CMS "Welcome Trigger" ON. |
| `[greeting] unknown-visitor <id> — not in the visitor table` | The vision service and API use different databases. |
| `[greeting] name not speakable — treated as unknown` | Name was blank or a placeholder. |
| `[greeting] rename of <id>: not in the room — no greeting` | Not seen within `GREET_PRESENCE_WINDOW_SECONDS`. Their next arrival greets normally. |
| `[greeting] welcome-screen experience not found — run db:seed-welcome` | No `welcome-screen` experience. Nothing is shown or said; the visitor counts as greeted. |
| `[greeting] <what> failed — greetings paused for 5 min: <detail>` | A database (or screen) error. `relation "visitor_greeting" does not exist` → apply migration 0039; `column "skip_reason"` → 0040; `app_setting` → 0041. Resumes by itself. |
| `[greeting] could not read the arm setting … starting DISARMED` | `app_setting` missing (migration 0041). Arm it in the CMS after migrating. |
| `[greeting] welcome-screen reverted to default media after Ns` | Normal. `(screen re-blanked)` = it was blanked before. |
| `[greeting] welcome-screen no longer showing — revert skipped` | Someone assigned other content during the welcome. Normal. |
| `[greeting] revert skipped (whiteboard live)` / `whiteboard ended — reverted welcome` | A whiteboard was drawn over the welcome screen; reverted when it ended. |
| `[greeting] reverted stale welcome-screen on startup` | The API restarted during a welcome screen. |
| `[greet] no screen connected to speak on: "…"` | The line was sent to 0 sockets. |
| `[greet] TV spoke with voice "X"` | Speech worked on the TV. |
| `[greet] TV did NOT speak: <reason>` | `speechSynthesis` missing · "speech did not start" (blocked by the browser, or no working voice) · engine error. Check the kiosk PC's voices; set `GREETING_VOICE_NAME`. |
| `[greet] (voice off) "<text>"` | `GREETING_VOICE=off`. |

**Dev: the variables don't reach the API.** Turbo's strict env mode drops undeclared shell variables. `apps/api/turbo.json` declares them for the `dev` task only. If you add a variable, add it there too (and never `DATABASE_URL`).

---

## 9. Known limitations

- State is **per API process** (batch queue, revert timer, snapshot, whiteboard watch, greeted-today cache). Production runs one API container; two would each push the welcome screen.
- A restart during a welcome screen that began from a **blanked** screen comes back idle and un-blanked (the boot reset clears every screen's blank state anyway).
- If a whiteboard is started over the welcome screen the timed revert stands down; the welcome screen stays assigned underneath until the whiteboard ends (a 3 s poll, up to 1 h) or the operator assigns something else.
- A dropped `VISITOR_DETECTED` (vision queue full / API down) is not retried; it is re-sent by the next 30 s touch **only if the person is still in frame**.
- A wrong face match greets the wrong name; the greeting layer cannot see match confidence (follow-up).
- Renames made outside the API (the Python `set_name` scripts) aren't seen until the next day.
- The skip check cannot see videos inside iframes; speech on the kiosk depends on the PC's installed voices.
- `GREETING_VOICE=travis` is a stub.
- The committed migrations cannot build an empty database (pre-existing), and the snapshot chain is incomplete (see follow-ups).

## 10. Follow-ups (not in this change)

- Repair the migration snapshot chain before anyone runs `db:generate` (it would emit spurious `ambient_mode`/`visitor_greeting` statements).
- A "whiteboard ended" event from the gateway instead of polling.
- A short negative cache for unknown uuids.
- Rename `door-screen-trigger.ts` (it now holds the arm switch and the legacy welcome push).
- Centralise `GreetingKind` in `@platform/types`.
- Match distance/vote fraction in the vision event.
