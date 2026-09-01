# packages/ — Shared Libraries Directory

> **Contains:** 5 shared TypeScript packages consumed by the apps.
> **None of these have servers or ports** — they are pure code libraries.
> **All are private** (not published to npm).

---

## What Lives Here

```
packages/                  ← YOU ARE HERE
├── types/     → shared TypeScript interfaces (used by EVERYTHING)
├── db/        → database client + Drizzle ORM schema
├── iot/       → MQTT helpers + device abstractions
├── ui/        → shared React components
└── config/    → shared ESLint + TypeScript configs
```

---

## The Golden Rule of This Folder

```
packages/ NEVER imports from apps/
apps/     CAN import from packages/
packages/ CAN import from other packages (with care — see below)
```

**Allowed inter-package imports:**

```
@platform/types  ←──── imported by ALL other packages + apps
@platform/db     ←──── imports @platform/types only
@platform/iot    ←──── imports @platform/types only
@platform/ui     ←──── imports react only (no @platform deps)
```

---

## Why These Packages Exist (Not Just Put Code in Apps)

| Problem Without Packages | Solution |
|---|---|
| `apps/cms` and `apps/screens` both need the Screen type — who defines it? | `@platform/types` defines it once |
| CMS and Screens both need a StatusBadge component — copy-paste? | `@platform/ui` shares it |
| MQTT normalization logic duplicated in api + screens? | `@platform/iot` centralizes it |
| DB queries scattered across apps? | `@platform/db` is the single access point |

---

## Build Order (Turborepo enforces this automatically)

```
Step 1 — builds first (no deps):
  @platform/types
Step 2 — builds after step 1:
  @platform/db    (needs types)
  @platform/iot   (needs types)
  @platform/ui    (needs react only)

Step 3 — builds after step 2:
  @platform/api     (needs types + db + iot)
  @platform/cms     (needs types + db + ui)
  @platform/screens (needs types + ui + iot)
```

---

## How Apps Import From Packages

After `pnpm install`, pnpm creates symlinks:
```
apps/api/node_modules/@platform/types  →  packages/types
apps/api/node_modules/@platform/iot   →  packages/iot
```

When `apps/api/src/index.ts` does:
```typescript
import { Screen } from '@platform/types';
```
Node.js follows the symlink → finds `packages/types/dist/index.js` (compiled output).

**This means packages must be built** (`pnpm build`) before apps can import them.
Exception: `apps/cms` and `apps/screens` use `transpilePackages: ['@platform/ui']` in `next.config.mjs` which lets Next.js compile the source directly.

---

## Go Deeper

- [`types/structure.md`](./types/structure.md)
- [`db/structure.md`](./db/structure.md)
- [`iot/structure.md`](./iot/structure.md)
- [`ui/structure.md`](./ui/structure.md)
- [`config/structure.md`](./config/structure.md)
