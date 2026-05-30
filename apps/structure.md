# apps/ — Applications Directory

> **Contains:** 3 runnable servers — the actual software users and screens interact with.
> **All packages here are private** (not published to npm).

---

## What Lives Here

```
apps/                   ← YOU ARE HERE
├── api/                → Hono REST + WebSocket + MQTT gateway  (port 4000)
├── cms/                → Next.js Admin CMS dashboard           (port 3000)
└── screens/            → Next.js Screen Player                 (port 3001)
```

---

## How the 3 Apps Relate to Each Other

```
apps/cms  (Admin Dashboard)
  │  Admin manages content, playlists, schedules, rules
  │  Calls REST API ──────────────────────────────────►  apps/api
  │                                                          │
  │                                                    reads/writes DB
  │                                                    listens to MQTT
  │                                                          │
apps/screens  (Screen Player)                               │
  │  Fetches its playlist via REST ──────────────────► apps/api
  │  Connects via WebSocket  ◄──────── real-time push  apps/api
  │  Shows content full-screen
  │
  └── Both cms + screens share UI components from packages/ui
```

---

## Packages Each App Imports

| App | Imports From |
|---|---|
| `apps/api` | `@platform/types` `@platform/db` `@platform/iot` |
| `apps/cms` | `@platform/types` `@platform/db` `@platform/ui` |
| `apps/screens` | `@platform/types` `@platform/ui` `@platform/iot` |

---

## Running the Apps

```bash
# All 3 at once (recommended in dev)
pnpm dev

# Individual apps
pnpm --filter="@platform/api"     dev   # starts :4000
pnpm --filter="@platform/cms"     dev   # starts :3000
pnpm --filter="@platform/screens" dev   # starts :3001
```

---

## Go Deeper

- [`api/structure.md`](./api/structure.md)
- [`cms/structure.md`](./cms/structure.md)
- [`screens/structure.md`](./screens/structure.md)
