# apps/screens — Screen Player

> **Package name:** `@platform/screens`
> **Port:** `3001` (dev). In production served under **`/display`** via Nginx (`basePath`).
> **Framework:** Next.js 15 (App Router)
> **Who uses it:** each physical display, opened in a kiosk browser at `…/display/<screenId>`

---

## What Lives Here

```
apps/screens/
├── src/
│   ├── app/
│   │   ├── layout.tsx              → root HTML shell (black, no-scroll)
│   │   ├── page.tsx                → launcher: lists screens to open
│   │   ├── [screenId]/page.tsx     → THE player route — resolves a screen's content
│   │   └── api/config/[screenId]/route.ts → server route that returns a screen's content
│   ├── components/display/
│   │   ├── LiveScreenPlayer.tsx    → client shell: WS + preloader + renderer + picker
│   │   ├── ContentRenderer.tsx     → switch on content.type → the right renderer
│   │   ├── VideoRenderer / ImageRenderer / HtmlRenderer / StreamRenderer
│   │   ├── LiveStreamRenderer.tsx  → live WebSocket video (WebCodecs/MJPEG canvas)
│   │   ├── ExperienceDisplay.tsx   → fallback for an experience with no/standby template
│   │   ├── ContentPickerOverlay.tsx→ long-press touch picker (screen-side content switch)
│   │   ├── ContentTitleOverlay.tsx, IdleDisplay.tsx, IdleScreenPlayer.tsx
│   ├── hooks/
│   │   ├── useScreenWebSocket.ts   → content WS: REGISTER + receive CONTENT_UPDATE
│   │   └── useContentPreloader.ts  → preload next asset, swap with ~0 flicker
│   ├── lib/
│   │   ├── client-urls.ts          → resolve relative /api, /ws to absolute (dev + prod)
│   │   └── display-config.ts       → server-side: fetch a screen's content from the API
│   └── types/display.ts            → Content union (video/image/html/stream/experience)
├── next.config.mjs                 → standalone output + conditional basePath /display
└── package.json
```

(The live-stream **decode** hook + canvas live in `@platform/ui` `templates/live-stream` and
are reused by both this app and the CMS preview.)

---

## What This App Does

```
TV opens  http://192.168.1.250/display/<screenId>
    │
    ▼
[screenId]/page.tsx (server)
    ├── resolveDisplayConfig(screenId)  → GET INTERNAL_API_URL/api/screens/<id>/config
    │       └── current content from Postgres (experience+template, media, or idle)
    ▼
<LiveScreenPlayer> (client) renders <ContentRenderer> and:
    ├── opens a WebSocket (useScreenWebSocket) → REGISTER {screenId}
    │       └── on WELCOME / CONTENT_UPDATE → preload + swap content instantly
    ├── on (re)connect → re-fetch /api/config/<id> to converge on the DB (authoritative)
    └── long-press → ContentPickerOverlay → CONTENT_CHANGE_REQUEST (touch-side switch)
```

A change made in the CMS reaches the screen in milliseconds — no polling, no reload.

---

## Content types (`ContentRenderer`)

| `content.type` | Renderer | Notes |
|---|---|---|
| `video` / `image` / `html` | Video/Image/Html renderer | media assets |
| `stream` | `StreamRenderer` | a `<video>` URL (HLS/progressive) |
| `experience` | template renderer | `templateKey==="portfolio"` → portfolio; `"live-stream"` → **LiveStreamRenderer**; else `ExperienceDisplay` |

**LiveStreamRenderer** subscribes (`STREAM_SUBSCRIBE`) to the experience's `streamId` over the
gateway and decodes incoming binary frames (WebCodecs H.264 / MJPEG) onto a `<canvas>`; shows
"Waiting for stream…" until a publisher is live.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| → server-side | `apps/api` (`INTERNAL_API_URL`) | REST — resolve current content |
| ↔ browser | `apps/api` `/ws` | WebSocket — content updates + live-stream frames |
| → imports | `@platform/ui` | ScreenStage, portfolio + live-stream renderers/hook |
| → imports | `@platform/types` | `WsContent`, `Ws*Message` |
| ← traffic from | Nginx `:80` | `/display/...` → `screens:3001` (basePath `/display`) |

---

## Environment Variables Used

| Variable | Purpose |
|---|---|
| `INTERNAL_API_URL` | Server-side base URL to reach the API (`http://api:4000` in Docker) |
| `NEXT_PUBLIC_API_URL` | Browser REST base (relative `/api` in prod) |
| `NEXT_PUBLIC_WS_GATEWAY_URL` | Browser WebSocket base (relative `/ws` in prod) |
| `NEXT_PUBLIC_SCREENS_BASE_PATH` | `/display` in the prod image so routes/assets live under `/display` |
