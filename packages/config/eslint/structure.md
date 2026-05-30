# packages/config/eslint — ESLint Configuration

> **Contains:** Shared ESLint rules for the entire monorepo.

---

## What Lives Here

```
packages/config/eslint/    ← YOU ARE HERE
└── base.json              → shared ESLint rule set
```

---

## File: `base.json`

```json
{
  "env": {
    "browser": true,
    "es2022": true,
    "node": true
  },
  "extends": ["eslint:recommended"],
  "rules": {
    "no-unused-vars": "warn",
    "no-console": ["warn", { "allow": ["warn", "error", "info"] }]
  }
}
```

### What Each Section Does

**`env`** — tells ESLint which globals exist:
- `browser: true` → `window`, `document`, `fetch`, `localStorage` are valid
- `es2022: true` → `Promise`, `Map`, `Set`, `Array.at()` etc are valid
- `node: true` → `process`, `Buffer`, `__dirname`, `require` are valid

**`extends: ["eslint:recommended"]`** — enables a curated set of proven rules:
- No undefined variables
- No duplicate case in switch
- No unreachable code
- No invalid regex
- and ~50 more standard rules

**`no-unused-vars: "warn"`** — declared but unused variables show a yellow warning. Set to `"error"` in production if you want to prevent all dead code.

**`no-console: ["warn", { "allow": ["warn", "error", "info"] }]`**
- `console.log(...)` → ⚠️ warning (use proper logging in production)
- `console.info(...)` → ✅ allowed (server startup banners use this)
- `console.warn(...)` → ✅ allowed
- `console.error(...)` → ✅ allowed

---

## How to Use in an App/Package

```json
// apps/api/.eslintrc.json (future)
{
  "extends": ["@platform/config/eslint/base"],
  "rules": {
    // app-specific overrides here
  }
}
```
