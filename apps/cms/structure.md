# apps/cms — Admin CMS Dashboard

> **Package name:** `@platform/cms`
> **Port:** `3000`
> **Framework:** Next.js 15 (App Router)
> **Who uses it:** Platform administrators (in a browser)

---

## What Lives Here

```
apps/cms/                  ← YOU ARE HERE
├── src/
│   └── app/
│       ├── layout.tsx     → root HTML shell (wraps all pages)
│       └── page.tsx       → admin home page (renders at /)
├── next.config.mjs        → Next.js configuration
├── package.json           → dependencies + npm scripts
└── tsconfig.json          → TypeScript config (Next.js bundler mode)
```

---

## What This App Does

The **admin control panel** — a browser web app where admins:

```
Admin opens http://cms.platform.local
    │
    ▼
apps/cms renders the dashboard
    │
    ├── displays screen statuses   ─────────────────────► GET /api/screens
    ├── shows content library      ─────────────────────► GET /api/content
    ├── creates/edits schedules    ─────────────────────► POST /api/schedules
    ├── configures rules           ─────────────────────► POST /api/rules
    └── uses shared UI components  ◄──────────────────── @platform/ui
```

---

## File: `src/app/layout.tsx`

```
Purpose:  Root HTML shell — rendered ONCE, wraps every page.
          Next.js App Router requires this file to exist.

What it contains:
  <html lang="en">
    <body>
      {children}   ← every page renders here
    </body>
  </html>

Future additions:
  - Google Fonts link
  - Global CSS import
  - Auth provider wrapper
  - Toast notification provider
```

**Connects to:** Nothing — it's the outermost structural wrapper.

---

## File: `src/app/page.tsx`

```
Purpose:  Admin home page — renders at http://localhost:3000/

Current (placeholder):
  Imports Button from @platform/ui       ← verifies UI package import works
  Renders: <h1>Admin CMS Placeholder</h1>

Future:
  ├── fetch list of all screens from /api/screens
  ├── display screen grid with StatusBadge (online/offline/maintenance)
  ├── show content library with previews
  └── calendar view of active schedules
```

**Data flow (future):**
```
page.tsx mounts
  → fetch('http://localhost:4000/api/screens')  → DEMO_SCREENS array → displayed
  → fetch('http://localhost:4000/api/content')  → DEMO_CONTENT array → displayed
```

---

## File: `next.config.mjs`

```js
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@platform/ui'],   ← KEY CONFIG
};
```

**Why `transpilePackages`?**
`@platform/ui` contains TypeScript/TSX source. Without this, Next.js would look for a pre-built `dist/` folder. With `transpilePackages`, Next.js compiles the UI package itself — meaning you can edit a shared component and see it hot-reload instantly without running a separate build step.

---

## File: `package.json`

```
name: @platform/cms
scripts:
  dev       → next dev -p 3000    (hot-reload Next.js on port 3000)
  build     → next build          (optimized production bundle in .next/)
  start     → next start          (serve the production bundle)
  lint      → next lint           (Next.js ESLint rules)
  typecheck → tsc --noEmit        (type validation without emitting)
```

**Key dependencies:**

| Package | Why |
|---|---|
| `next@^15` | Framework — routing, SSR, bundler |
| `react` + `react-dom` | UI rendering |
| `@platform/types` | Type contracts for API responses |
| `@platform/db` | Future: server-side queries in Server Components |
| `@platform/ui` | Shared buttons, cards, status badges |

---

## File: `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",   ← Next.js uses its own bundler, not Node
    "noEmit": true,                  ← Next.js handles compilation, not tsc
    "jsx": "preserve",               ← Next.js transforms JSX itself
    "paths": { "@/*": ["./src/*"] }  ← import '@/components/...' shortcut
  }
}
```

---

## Connects To

| Direction | Target | How |
|---|---|---|
| → calls | `apps/api :4000` | HTTP fetch (REST) |
| → imports | `@platform/ui` | Button, ScreenCard, StatusBadge |
| → imports | `@platform/types` | Screen, Content, Playlist types |
| ← receives from | `apps/api` WebSocket | Future: live telemetry updates |
| ← traffic from | Nginx `:80` | `cms.platform.local → :3000` |
