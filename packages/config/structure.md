# packages/config — Shared ESLint & TypeScript Configs

> **Package name:** `@platform/config`
> **Purpose:** Central config store — one place defines all lint rules and TS options
> **Depends on:** Nothing
> **Used by:** Every package and app (via `extends` in their config files)

---

## What Lives Here

```
packages/config/           ← YOU ARE HERE
├── eslint/
│   └── base.json          → shared ESLint rules
├── typescript/
│   └── base.json          → shared TypeScript compiler options
├── package.json           → exports map for both configs
└── tsconfig.json          → minimal self-config
```

---

## Why This Package Exists

Without `@platform/config`:
```
apps/api/tsconfig.json      has 20 compiler options
apps/cms/tsconfig.json      copy-pastes same 20 options (maybe misses some)
packages/iot/tsconfig.json  copy-pastes again (now they drift)
→ One package is strict, another isn't. Bugs slip through.
```

With `@platform/config`:
```
packages/config/typescript/base.json  defines all 20 options ONCE
apps/api/tsconfig.json      → { "extends": "../../tsconfig.base.json" }
apps/cms/tsconfig.json      → { "extends": "../../tsconfig.base.json" }
packages/iot/tsconfig.json  → { "extends": "../../tsconfig.base.json" }
→ All identical, all strict, zero drift.
```

---

## File: `eslint/base.json`

```json
{
  "env": {
    "browser": true,   ← window, document, fetch available
    "es2022": true,    ← modern JS globals
    "node": true       ← process, __dirname, Buffer available
  },
  "extends": ["eslint:recommended"],
  "rules": {
    "no-unused-vars": "warn",
    "no-console": ["warn", { "allow": ["warn", "error", "info"] }]
  }
}
```

**`no-console` with allow list:** `console.log` is warned (use proper logging). `console.info`, `console.warn`, `console.error` are allowed — we use `console.info` for server startup banners.

**`no-unused-vars: "warn"`** — declaring a variable and never using it is a warning, not an error (allows work-in-progress code to still run).

---

## File: `typescript/base.json`

This mirrors `tsconfig.base.json` at the monorepo root.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

| Option | What it catches |
|---|---|
| `noUnusedLocals` | Variables declared but never used |
| `noUnusedParameters` | Function params declared but never used |
| `noImplicitReturns` | Function that sometimes returns a value, sometimes doesn't |
| `noUncheckedIndexedAccess` | `arr[0]` treated as `T \| undefined` — must null-check |
| `noFallthroughCasesInSwitch` | `case` without `break` accidentally falling through |

---

## File: `package.json` — Exports Map

```json
{
  "name": "@platform/config",
  "exports": {
    "./eslint/base":     "./eslint/base.json",
    "./typescript/base": "./typescript/base.json"
  }
}
```

**How another package uses it:**
```json
// any tsconfig.json in the repo
{
  "extends": "@platform/config/typescript/base"
}
```

The `exports` map resolves `@platform/config/typescript/base` → `./typescript/base.json`.

---

## File: `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["**/*.json"]
}
```

Minimal self-config. This package has no TypeScript source to compile — only JSON files to include for IDE support.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← extended by | All `tsconfig.json` files | `"extends": "../../tsconfig.base.json"` |
| ← extended by | All `.eslintrc` files (future) | `"extends": "@platform/config/eslint/base"` |
