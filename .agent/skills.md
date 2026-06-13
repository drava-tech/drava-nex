# Claude Code Skills for This Project

## Necessary Skills

These skills are used in the normal development loop for this project.

### `/run`
Starts the project and drives it to a working state.

In this project: invoke after `pnpm infra:up`. Confirm all three ports (3000, 3001, 4000) are listening before treating the stack as healthy. On Windows + Turborepo, port conflicts and missing `.env` values surface only at runtime.

**Reach for this when:** starting a new session, after pulling changes, or after any infra/config change.

### `/verify`
Runs the app and observes actual behavior to confirm a change works.

In this project: the real integration surface is Nginx-routed paths (`/api/`, `/screens/`, `/`), not unit tests. After any change, verify via both the direct port (e.g., `curl localhost:4000/api/screens`) and the Nginx path (`curl localhost/api/screens`). TypeScript cannot catch routing bugs.

**Reach for this when:** after any API route change, schema migration, or Nginx config edit.

### `/init`
Generates a `CLAUDE.md` file with codebase documentation.

In this project: `CLAUDE.md` does not yet exist and `AGENTS.md` is empty. This is the first thing needed when onboarding a new session or agent. Point it at `.doc/` and the per-package `structure.md` files as source material.

**Reach for this when:** starting a new major task, onboarding a new contributor agent, or the existing `CLAUDE.md` is stale.

### `/code-review`
Reviews the current diff for correctness bugs and simplification opportunities.

In this project: the API has no auth, uses demo data in several routes, and the MQTT bridge is partially implemented. All incremental changes need a correctness pass. Use `--fix` to apply suggestions automatically.

**Reach for this when:** before any commit, especially changes to `apps/api/src/`, `packages/db/src/schema/`, or anything touching CORS/MQTT.

### `/update-config`
Configures `.claude/settings.json` — hooks, permissions, and env vars.

In this project: `.claude/settings.local.json` currently only allows PowerShell. Docker Compose commands, `curl`, and `pnpm --filter` commands will prompt for permission every session until added to the allowlist.

**Reach for this when:** a new tool or command keeps triggering permission prompts.

### `/fewer-permission-prompts`
Scans transcripts and adds a prioritized allowlist to reduce permission prompts.

In this project: `pnpm --filter`, `docker compose`, `curl localhost:*`, and PowerShell are invoked every session. Run this after a few sessions to batch-add them.

**Reach for this when:** permission prompts are slowing down the dev loop.

---

## Optional Skills

Use these situationally — not every session.

| Skill | When to reach for it |
|---|---|
| `/simplify` | After a large feature lands (e.g., real DB queries replacing demo data) — clean up before the code sets |
| `/security-review` | Before any production deploy, or when adding auth, secrets handling, or changing CORS config |
| `/review` | When GitHub PRs exist (currently single-branch solo dev) |
| `/claude-api` | If LLM inference is added to the platform (e.g., AI-driven scheduling, IoT anomaly detection) |
| `/schedule` | When CI-style automation is needed — nightly health checks, scheduled DB snapshots |
| `/loop` | For polling `pnpm healthcheck` while infra is starting, or watching MQTT logs during IoT work |

---

## Not Applicable

- `/keybindings-help` — personal editor preference, not project-specific
