# apps/ — Applications Directory

> **Contains:** 2 runnable servers — the actual software users interact with.
> **All packages here are private** (not published to npm).

---

## What Lives Here

```
apps/                   ← YOU ARE HERE
├── api/                → Hono REST + WebSocket + MQTT gateway  (port 4000)
└── cms/                → Next.js Admin CMS dashboard           (port 3000)
```

---

## How the 3 Apps Relate to Each Other

```
apps/cms  (Admin Dashboard)
  │  Admin authors experiences (templates) + assigns content
  │  Writes Postgres (via @platform/db) and POSTs a content push ──► apps/api
  │                                                                     │
apps/api  (REST + WebSocket gateway + MQTT)                            │
  │  Source of truth lives in Postgres; broadcasts CONTENT_UPDATE ─────┘
  ▼                                                                     
```

---

## Packages Each App Imports

| App | Imports From |
|---|---|
| `apps/api` | `@platform/types` `@platform/db` `@platform/iot` |
| `apps/cms` | `@platform/types` `@platform/db` `@platform/ui` |

---

## Running the Apps

```bash
# Both at once (recommended in dev)
pnpm dev

# Individual apps
pnpm --filter="@platform/api"     dev   # starts :4000
pnpm --filter="@platform/cms"     dev   # starts :3000
```

---

## Go Deeper

- [`api/structure.md`](./api/structure.md)
- [`cms/structure.md`](./cms/structure.md)
