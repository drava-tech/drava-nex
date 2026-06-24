# apps/cms — Admin CMS Dashboard

> **Package name:** `@platform/cms`
> **Port:** `3000` (internal; reached through Nginx at `/`)
> **Framework:** Next.js 15 (App Router) · better-auth
> **Who uses it:** platform administrators (in a browser)

---

## What Lives Here

```
apps/cms/src/
├── middleware.ts                  → auth gate (redirects unauthenticated → /login)
├── app/
│   ├── (auth)/login               → login page
│   ├── (dashboard)/
│   │   ├── experiences            → experiences grid + create
│   │   ├── screens                → screen list, add/assign, live mirror + control
│   │   ├── screen/[screenId]      → single-screen control view
│   │   ├── media                  → media library
│   │   ├── users, environment     → user admin, environment demo views
│   ├── edit/experiences/[id]      → full-screen template editor (Workspace)
│   ├── preview/experiences/[id]   → chrome-less template preview (Layout)
│   └── api/{auth,media,upload,projects} → CMS-owned API routes (auth, media stream, upload)
├── actions/                       → server actions: screen / experience / project / user
├── templates/                     → template registry + per-template editors
│   ├── definitions.ts             → TEMPLATE_DEFINITIONS (Layout + Workspace per key)
│   ├── portfolio/                 → portfolio editor + layout
│   └── live-stream/               → live-stream editor (Generate URL) + layout
├── lib/                           → templates, broadcast, auth, auth-helpers, screen-url
├── hooks/useCmsScreenSync.ts      → WS client: receives SCREEN_UPDATED / active screens
└── components/                    → media-picker, theme, sidebar
```

---

## What This App Does

```
Admin logs in (better-auth) → dashboard
    ├── Experiences: create an experience → assign a template (portfolio / live-stream)
    │     → open the editor (/edit) → author templateContent → Save (DB)
    ├── Screens: add a screen, assign it an experience or media
    │     → assignExperience() writes DB + broadcasts over WS → the TV updates live
    │     → live mirror (iframe) + control console + online/offline status (useCmsScreenSync)
    └── Media: upload/manage assets used by templates & screens
```

The **template system** is central: code-defined templates are registered in
`lib/templates.ts` (`TEMPLATE_KEYS`) + `templates/definitions.ts` (each with a `Layout` for
preview and a `Workspace` editor). Per-experience content is saved via
`updateExperienceTemplateContent` and stored in `experience.templateContent` (JSONB). The
**Live Stream** editor generates a `streamId` and shows the publisher connection details.

---

## Real-time push (CMS → screens)

`actions/screen-actions.ts` `assignExperience`/`assignMedia` → write DB → `lib/broadcast.ts`
`broadcastWsContentDirect` → `POST INTERNAL_API_URL/api/internal/broadcast` (with
`BROADCAST_SECRET`). `hooks/useCmsScreenSync` keeps the dashboard in sync the other way.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| → reads/writes | `@platform/db` | server actions / route handlers (server-side) |
| → pushes | `apps/api` `/api/internal/broadcast` | server-side (`INTERNAL_API_URL`) |
| ↔ browser | `apps/api` `/ws` | `useCmsScreenSync` (live screen status/updates) |
| → imports | `@platform/ui` | template renderers (portfolio, live-stream), UI kit |
| → imports | `@platform/types` | `WsContent`, `Ws*Message` |
| ← traffic from | Nginx `:80` | `/` + the CMS-owned `/api/auth|upload|media` routes |

---

## Key environment variables

`DATABASE_URL`, `INTERNAL_API_URL=http://api:4000`, `BROADCAST_SECRET`, `BETTER_AUTH_URL` /
`BETTER_AUTH_SECRET` / `BETTER_AUTH_TRUSTED_ORIGINS`, `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_WS_GATEWAY_URL`, `NEXT_PUBLIC_SCREENS_URL`, `UPLOAD_DIR`.
