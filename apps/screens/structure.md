# apps/screens — Screen Player

> **Package name:** `@platform/screens`
> **Port:** `3001`
> **Framework:** Next.js 15 (App Router)
> **Who uses it:** Each physical display screen (runs in a browser kiosk mode)

---

## What Lives Here

```
apps/screens/              ← YOU ARE HERE
├── src/
│   └── app/
│       ├── layout.tsx     → root HTML shell
│       └── page.tsx       → player UI (renders content full-screen)
├── next.config.mjs        → Next.js configuration
├── package.json           → dependencies + npm scripts
└── tsconfig.json          → TypeScript config (Next.js bundler mode)
```

---

## What This App Does

The **screen player** — software running on a physical screen that:

```
Screen boots → opens http://screens.platform.local in kiosk browser
    │
    ▼
apps/screens page.tsx loads
    │
    ├── reads SCREEN_ID from env         ← which physical screen is this?
    ├── GET /api/screens/{SCREEN_ID}     ← fetch this screen's metadata
    ├── GET /api/screens/{SCREEN_ID}/playlist  ← fetch its content queue
    │
    ▼
Player loop starts:
    ├── show content[0] for duration[0] seconds
    ├── show content[1] for duration[1] seconds
    └── repeat forever
    │
    ▼ (simultaneously)
WebSocket connection open to ws://localhost:4000/ws
    └── on PLAYLIST_CHANGE → switch immediately  (IoT trigger scenario)
    └── on BRIGHTNESS_SET  → dim/brighten screen
    └── on REBOOT          → restart player
```

---

## File: `src/app/layout.tsx`

```
Purpose:  Root HTML shell for the player app.

Current:
  <html lang="en">
    <body>{children}</body>
  </html>

Future additions for a physical screen:
  - style={{ margin: 0, padding: 0, overflow: 'hidden' }}
  - body height: 100vh width: 100vw
  - cursor: none  (hide mouse on kiosk)
  - background: black (default between content)
```

---

## File: `src/app/page.tsx`

```
Purpose:  Main player page — the content that the physical screen sees.

Current (demo placeholder):
  Renders:
    - Screen name (Lobby Display)
    - Location + status (🟢 online)
    - Active playlist name
    - Playlist queue list (3 items with types + durations)

Future:
  const screenId = process.env.SCREEN_ID
  const playlist = await fetch(`/api/screens/${screenId}/playlist`)

  // Player loop
  for each content item:
    if type === 'image'   → <img src={url} />      for {duration} seconds
    if type === 'video'   → <VideoPlayer url={url} />
    if type === 'html'    → <iframe src={url} />
    if type === 'weather' → <iframe src={url} />
```

**Data flow (future):**
```
page.tsx renders
  ├── REST: GET /api/screens/{SCREEN_ID}/playlist
  │           ↓
  │   { items: [ {contentId, type, url, duration}, ... ] }
  │           ↓
  │   display each item in sequence
  │
  └── WebSocket: connect to ws://localhost:4000/ws
        on('PLAYLIST_CHANGE', newPlaylistId) → re-fetch + restart loop
```

---

## File: `next.config.mjs`

```js
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@platform/ui'],
};
```

Same as CMS — allows `@platform/ui`'s VideoPlayer and StatusBadge components to hot-reload without pre-building.

---

## File: `package.json`

```
name: @platform/screens
scripts:
  dev   → next dev -p 3001   ← NOTE: port 3001, not 3000 (CMS takes 3000)
  build → next build
  start → next start
```

**Key dependencies:**

| Package | Why |
|---|---|
| `@platform/types` | Screen, Content, IoTEvent types |
| `@platform/ui` | VideoPlayer, ScreenCard, StatusBadge components |
| `@platform/iot` | Future: subscribe directly to MQTT via browser WS (port 9001) |

---

## Connects To

| Direction | Target | How |
|---|---|---|
| → calls | `apps/api :4000` | REST — fetch screen + playlist |
| ← receives | `apps/api :4000/ws` | WebSocket — real-time playlist/command events |
| → imports | `@platform/ui` | VideoPlayer, StatusBadge components |
| → imports | `@platform/types` | Screen, Content, IoTEvent types |
| ← traffic from | Nginx `:80` | `screens.platform.local → :3001` |

---

## Environment Variables Used

| Variable | Purpose |
|---|---|
| `SCREEN_ID` | Unique identifier of this physical screen (e.g. `screen-001`) |
| `NEXT_PUBLIC_API_URL` | Base URL for REST calls (e.g. `http://localhost:4000`) |
| `NEXT_PUBLIC_WS_GATEWAY_URL` | WebSocket URL (e.g. `ws://localhost:4000/ws`) |
