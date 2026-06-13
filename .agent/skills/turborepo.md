# Turborepo + pnpm Workspaces — Best Practices

Source: turborepo.dev/repo/docs (official, fetched June 2026) + MuhammadUsmanGM/claude-code-best-practices community guide.

Used in: repo root (`turbo.json`, `pnpm-workspace.yaml`). Package manager: pnpm.

---

## Workspace Structure Rules

- **`apps/`** — runnable services and applications only (`cms`, `screens`, `api`)
- **`packages/`** — libraries and tooling only (`db`, `types`, `iot`, `ui`, `config`)
- Never nest packages: use `apps/*` and `packages/*` (flat globs), not `apps/**`
- Root `package.json` must have `"private": true` — never publish the workspace root
- Specify `packageManager` in root `package.json` to lock the pnpm version:
  ```json
  { "packageManager": "pnpm@9.x.x" }
  ```

## Package Configuration

- Give every package a namespaced name: `@platform/name` — prevents registry conflicts
- Use the `exports` field (not `main`) for package entrypoints:
  ```json
  {
    "exports": {
      ".": "./src/index.ts",
      "./schema": "./src/schema/index.ts"
    }
  }
  ```
- Source in `src/`, compiled output in `dist/` (convention — follow what's already set up per package)
- Every package needs its own `tsconfig.json` — do not put a root-level `tsconfig.json` (the repo has `tsconfig.base.json` as a shared base only)

## Internal Dependencies

- Always install internal packages as dependencies using the workspace protocol:
  ```json
  { "dependencies": { "@platform/types": "workspace:*" } }
  ```
- **Never cross-import via relative paths** (`../../packages/db`) — always go through the installed package name
- Adding a new internal dep: add to `package.json`, then run `pnpm install` from the repo root

## `turbo.json` — Task Configuration

- Define `outputs` for every cacheable task so Turborepo knows what to cache:
  ```json
  {
    "tasks": {
      "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
      "dev": { "persistent": true, "cache": false },
      "typecheck": { "dependsOn": ["^typecheck"] }
    }
  }
  ```
- Mark long-running tasks as `"persistent": true` (`dev`, `db:studio`) — they stay running and don't block
- Set `"cache": false` for tasks that should always re-run (`dev`, `db:push`, `db:migrate`)
- Use `"dependsOn": ["^build"]` to ensure a package's dependencies are built first

## Running Commands

- Run a task across all packages: `pnpm build`, `pnpm dev`, `pnpm typecheck`
- Scope to a single package: `pnpm --filter @platform/db db:generate`
- Scope to an app: `pnpm --filter @platform/cms build`
- Run from any directory — Turborepo resolves the workspace root automatically

## Caching

- Turborepo caches task outputs based on input file hashes — re-running unchanged packages is instant
- If a build is unexpectedly cached, force a re-run: `pnpm build --force`
- Remote caching (Vercel Remote Cache) can be configured to share cache across CI and developer machines

## Common Pitfalls

- **Missing `outputs` in `turbo.json`** — Turborepo won't cache results correctly; always declare output dirs
- **Circular dependencies** — `@platform/db` must not import from `apps/*`; only apps import packages
- **Installing at wrong level** — always run `pnpm install` from the repo root, not inside a package directory (pnpm hoists correctly only from root)
- **Importing from `src/` directly** — always import from the package name (`@platform/ui`), not from a file path; the `exports` field defines what's public
