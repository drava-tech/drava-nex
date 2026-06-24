# packages/ui — Shared React Component Library

> **Package name:** `@platform/ui`
> **Purpose:** shared UI kit **and** the code-defined content templates
> **Depends on:** `react` · `react-dom` (peer) · Radix UI · Tailwind v4 · lucide
> **Used by:** `apps/cms` · `apps/screens`

---

## What Lives Here

```
packages/ui/src/
├── index.tsx                  → UI kit entry (shadcn-style primitives)
├── components/ui/             → sidebar, sheet, tooltip, dropdown-menu, avatar,
│                                breadcrumb, collapsible, separator …
├── hooks/use-mobile.ts        → responsive helper
├── lib/utils.ts               → cn() class merge
└── templates/                 → the CONTENT TEMPLATES (shared by CMS + screens)
    ├── portfolio/             → ScreenStage, OverviewView, PortfolioRenderer, content.ts
    └── live-stream/           → content.ts, use-live-stream.ts (WS subscribe + decode),
                                 live-stream-canvas.tsx (WebCodecs/MJPEG → <canvas>)
```

Built to `dist/` via `tsc`. Consumed through the `exports` map: `.` (UI kit),
`./templates/portfolio`, `./templates/live-stream`, `./globals.css`.

---

## What This Package Does

Two roles:

1. **UI kit** — Radix + Tailwind primitives the CMS dashboard is built from (sidebar, menus,
   tooltips, …).
2. **Templates** — the per-template content shapes + renderers, shared so the CMS edits/previews
   exactly what a screen renders:
   - `portfolio` — a 1920×1080 authored layout (`ScreenStage` scales it to any display).
   - `live-stream` — `useLiveStream(streamId)` opens a WebSocket, subscribes, decodes incoming
     binary frames (WebCodecs H.264 / `createImageBitmap` MJPEG) and paints a `<canvas>`;
     `LiveStreamCanvas` wraps it with a "Waiting for stream…" state.

Adding a template = a new folder here (`content.ts` + renderer) + registration in
`apps/cms/src/lib/templates.ts` and `templates/definitions.ts`, plus a branch in the screens
`ContentRenderer`.

---

## Why `transpilePackages` + a build

Apps list `transpilePackages: ['@platform/ui']`, but imports resolve to `dist/` via the
`exports` map — so after changing `packages/ui`, rebuild it (`pnpm --filter @platform/ui build`)
for the new subpath/types to resolve. React is a **peer** dep so there's only one React instance.

---

## Connects To

| Direction | Target | How |
|---|---|---|
| ← imported by | `apps/cms` | UI kit + template editors/previews |
| ← imported by | `apps/screens` | portfolio + live-stream renderers, ScreenStage |
| → imports | `@platform/types` (dev) | `Ws*Message`, `StreamFormat` (type-only, in the hook) |
| compiled to | `dist/` | `tsc`; resolved by Next via the `exports` map |
