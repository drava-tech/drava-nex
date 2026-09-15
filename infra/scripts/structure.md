# infra/scripts — Utility Scripts

> **Contains:** Shell scripts for bootstrapping and maintaining the platform.
> **Run on:** Developer machine (not inside Docker).

---

## What Lives Here

```
infra/scripts/             ← YOU ARE HERE
├── bootstrap.sh           → first-time setup script
├── free-dev-ports.mjs     → frees ports 3000/4000 from OUR leftover dev
│                            servers before `pnpm dev` (Windows keeps them
│                            alive when a terminal closes). Never touches a
│                            process from outside this repo.
└── dev-api.mjs            → apps/api dev runner: tsc --watch + compiled node.
                             Replaces `tsx watch`, which took ~17s to boot vs
                             ~2s compiled.
```

---

## File: `bootstrap.sh`

```bash
#!/usr/bin/env bash
set -e    ← if any command fails, stop immediately (don't continue silently)

pnpm install    ← installs all workspace deps + creates symlinks
pnpm run build  ← builds all packages in Turborepo dependency order
```

**Purpose:** One command to get from a fresh clone to a fully built monorepo.

**When to use it:**
- First time cloning the repo on a new machine
- After pulling major changes (new packages added, dep versions changed)
- When a new team member joins

**How to run:**
```bash
# Windows (Git Bash or WSL)
bash infra/scripts/bootstrap.sh

# Linux / macOS
chmod +x infra/scripts/bootstrap.sh
./infra/scripts/bootstrap.sh
```

**What happens internally:**

```
bootstrap.sh runs
  │
  ├── pnpm install
  │     ├── reads pnpm-workspace.yaml → discovers all 8 workspaces
  │     ├── reads package.json in each workspace
  │     ├── resolves all dependencies
  │     ├── creates node_modules/.pnpm (content-addressable store)
  │     └── creates symlinks:
  │           node_modules/@platform/types → packages/types
  │           node_modules/@platform/iot  → packages/iot
  │           ... etc
  │
  └── pnpm run build  (calls turbo run build)
        ├── Step 1: @platform/types → tsc → dist/
        ├── Step 2: @platform/db, @platform/iot, @platform/ui (parallel)
        └── Step 3: @platform/api, @platform/cms, @platform/screens (parallel)
```

---

## What Gets Added in Future

```
infra/scripts/
├── bootstrap.sh       ← already exists
├── deploy.sh          → builds + pushes Docker images
├── seed-db.sh         → seeds PostgreSQL with initial demo data
├── check-health.sh    → hits /api/health on all services and reports status
└── backup-db.sh       → dumps PostgreSQL to a timestamped file
```

---

## Connects To

| What it runs | Result |
|---|---|
| `pnpm install` | All 8 workspace packages have their deps installed |
| `pnpm run build` | All TypeScript compiled, all `dist/` folders populated |
| Reads | `pnpm-workspace.yaml` for workspace discovery |
| Reads | `turbo.json` for build task ordering |
