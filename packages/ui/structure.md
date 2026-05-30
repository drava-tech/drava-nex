# packages/ui — Shared React Component Library

> **Package name:** `@platform/ui`
> **Purpose:** Shared React UI components used across CMS and Screen Player
> **Depends on:** `react` · `react-dom` (as peer deps)
> **Used by:** `apps/cms` · `apps/screens`

---

## What Lives Here

```
packages/ui/               ← YOU ARE HERE
├── src/
│   └── index.ts           → all exported React components
├── package.json           → deps: react, react-dom (+ as peerDeps)
└── tsconfig.json          → compiles to dist/
```

---

## What This Package Does

Provides **reusable UI building blocks** so both the admin dashboard and the screen player share the same visual language without copy-pasting components.

```
apps/cms page.tsx:
  import { Button, ScreenCard, StatusBadge } from '@platform/ui'
  <ScreenCard screen={lobbyDisplay} />     ← same component as screens app
  <StatusBadge status="online" />

apps/screens page.tsx:
  import { StatusBadge, VideoPlayer } from '@platform/ui'
  <VideoPlayer url={content.url} />        ← same VideoPlayer everywhere
  <StatusBadge status={screen.status} />
```

---

## File: `src/index.ts`

### Current State (Placeholders)

```typescript
export const Button      = () => "UI Button Placeholder"
export const ScreenCard  = () => "Screen Card UI Placeholder"
export const StatusBadge = () => "Status Badge UI Placeholder"
export const VideoPlayer = () => "Video Player UI Placeholder"
```

These verify that imports work across the monorepo. They return strings now, will return JSX next.

### Future State (Real Components)

```typescript
// Button — used in CMS forms, toolbars
export const Button = ({
  label, onClick, variant = 'primary', disabled = false
}: ButtonProps) => (
  <button
    className={`btn btn-${variant}`}
    onClick={onClick}
    disabled={disabled}
  >
    {label}
  </button>
)

// ScreenCard — used in CMS screen management grid
export const ScreenCard = ({ screen }: { screen: Screen }) => (
  <div className="screen-card">
    <h3>{screen.name}</h3>
    <p>{screen.location}</p>
    <StatusBadge status={screen.status} />
  </div>
)

// StatusBadge — online/offline/maintenance indicator
export const StatusBadge = ({ status }: { status: Screen['status'] }) => {
  const colors = { online: 'green', offline: 'red', maintenance: 'yellow' }
  return <span className={`badge badge-${colors[status]}`}>{status}</span>
}

// VideoPlayer — full-screen video renderer for Screen Player
export const VideoPlayer = ({ url, duration }: VideoPlayerProps) => (
  <video
    src={url}
    autoPlay muted loop
    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
  />
)
```

---

## How `transpilePackages` Makes Hot-Reload Work

Both `apps/cms` and `apps/screens` have in their `next.config.mjs`:
```js
transpilePackages: ['@platform/ui']
```

**Without it (broken):**
```
Next.js looks for: packages/ui/dist/index.js
File not found! → "Module not found" error
(you'd have to run `pnpm build` in packages/ui every time you change a component)
```

**With it (working):**
```
Next.js directly compiles: packages/ui/src/index.ts
Change a component → Next.js hot-reloads instantly → see change in browser
```

---

## File: `package.json`

```json
{
  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "peerDependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" }
}
```

**Why peerDeps?** Apps using `@platform/ui` already have React installed. If ui listed React only as a regular dep, there could be two different React instances in the app — which breaks hooks. peerDeps tells pnpm "use the host app's React, don't install another one."

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← imported by | `apps/cms` | Button, ScreenCard, StatusBadge in admin UI |
| ← imported by | `apps/screens` | VideoPlayer, StatusBadge in player UI |
| Compiled by | Next.js bundler | via `transpilePackages` — no pre-build needed |
