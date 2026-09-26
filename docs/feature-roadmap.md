# Feature Roadmap — Competitive Gaps

_Last updated: 2026-09-15 · Status: **planning only, nothing implemented**_

Features our platform lacks compared with [FocusReactive](https://focusreactive.com/) (headless-CMS
agency) and [T1V](https://www.t1v.com/) (ThinkHub collaboration + T1V Story experiences). Each gap
was checked against the current codebase.

## Summary

| # | Feature | Priority | Seen at |
|---|---|---|---|
| 1 | Content scheduling & playlists | P1 | FocusReactive |
| 2 | Wireless screen sharing | P1 | T1V |
| 3 | Drafts, approvals & version history | P1 | FocusReactive |
| 4 | Granular roles, audit trail & SSO | P1 | FocusReactive |
| 5 | Map, Timeline & Hotspot Image templates | P1 | T1V Story |
| 6 | Personalised content for recognised visitors | P2 | FocusReactive |
| 7 | Multi-language content & AI translation | P2 | FocusReactive |
| 8 | Mixed-content whiteboard canvas | P2 | T1V |
| 9 | Video conferencing | P2 | T1V |
| 10 | Span content across displays / video wall | P2 | T1V |
| 11 | Third-party integrations (M365, Canva, Figma, Miro) | P2 | T1V |
| 12 | AI content assistance | P3 | FocusReactive, T1V |
| 13 | Semantic media search | P3 | FocusReactive |
| 14 | Multi-site management | P3 | T1V |
| 15 | No-code content blocks | P3 | FocusReactive |

**P1** — table stakes a client will notice in a demo · **P2** — strengthens experiences and meeting
rooms · **P3** — later / scale.

---

## P1 — Must have

### 1. Content scheduling & playlists
- **Today:** a screen changes only when someone pushes content. No time-based programming, no playlists.
- **Goal:** schedule experiences/media per screen by date, time and day of week; rotating playlists; fall back to default media when nothing is scheduled.
- **Touches:** [screens schema](../packages/db/src/schema/screens.ts), `pushScreenContent` in [routes/screens.ts](../apps/api/src/routes/screens.ts), a timer service like [screen-uptime.ts](../apps/api/src/services/screen-uptime.ts).
- **Open questions:** does a manual push override the schedule, and for how long? How does it interact with the camera-triggered Welcome screen ([door-screen-trigger.ts](../apps/api/src/services/door-screen-trigger.ts))?

### 2. Wireless screen sharing
- **Today:** no casting from laptops/phones. Live stream only accepts our own publisher app; the trackpad controls the screen PC itself.
- **Goal:** a visitor opens a URL (or scans a QR code on the screen), picks a screen, and shares their laptop/phone screen — no install.
- **Touches:** browser `getDisplayMedia` on the sender; the existing live-stream pipeline ([live-stream template](../apps/cms/src/templates/live-stream), [WS gateway](../apps/api/src/ws/gateway.ts)) may carry the frames before reaching for WebRTC.
- **Open questions:** guest access without a CMS login (one-time PIN per screen?); latency target; audio.

### 3. Drafts, approvals & version history
- **Today:** saving an experience overwrites `templateContent`; no review step, no undo. Only products have a `DRAFT` status ([products schema](../packages/db/src/schema/products.ts)).
- **Goal:** draft vs published content, optional approval before publish, revision list with restore.
- **Touches:** [projects schema](../packages/db/src/schema/projects.ts) (`experience`), experience editor save action, new revision table.
- **Open questions:** who approves — any ADMIN or a dedicated role (see #4)?

### 4. Granular roles, audit trail & SSO
- **Today:**
  - 3 fixed roles: `ADMIN`, `GUEST`, `SUPERADMIN` ([auth schema](../packages/db/src/schema/auth.ts)).
  - The push log ([screen-content-pushes.ts](../packages/db/src/schema/screen-content-pushes.ts)) doesn't record **who** pushed.
  - Email + password login only ([api auth](../apps/api/src/lib/auth.ts), [cms auth](../apps/cms/src/lib/auth.ts)).
- **Goal:** roles like Editor / Operator / Viewer; per-action audit log (who, what, when, which screen); Microsoft and Google sign-in.
- **Touches:** role enum + `requireAuth()` checks; add user id to the push log (whiteboards already track `createdByUserId`/`updatedByUserId` — [whiteboards schema](../packages/db/src/schema/whiteboards.ts)); better-auth social/SSO providers.
- **Open questions:** which identity provider does the client use (Entra ID / Google Workspace)?

### 5. Map, Timeline & Hotspot Image templates
- **Today:** 7 templates (Portfolio, Gallery, Product Showcase, Welcome, Live Stream, Flight Simulation, Object Recognition) — no map, timeline or hotspot image.
- **Goal:**
  - **Interactive Map** — colour-coded pins, filters, content per pin.
  - **Interactive Timeline** — milestones with images/video/text, filters.
  - **Hotspot Image** — tap points on an image open a lightbox (image, video, PDF).
- **Touches:** one entry each in [definitions.ts](../apps/cms/src/templates/definitions.ts) + layout/editor under `packages/ui/src/templates/`.
- **Open questions:** map tiles offline or online? (screens may not have internet).

---

## P2 — Experiences & meeting rooms

### 6. Personalised content for recognised visitors
- **Today:** face recognition identifies visitors, but the Welcome screen is identity-agnostic — any detected person triggers the same content.
- **Goal:** greet known visitors by name; show content tied to them (e.g. their project).
- **Touches:** vision events in [internal.ts](../apps/api/src/routes/internal.ts), [door-screen-trigger.ts](../apps/api/src/services/door-screen-trigger.ts), Welcome template content.
- **Open questions:** visitor consent and privacy policy before showing names on a public screen.

### 7. Multi-language content & AI translation
- **Today:** single language, no i18n.
- **Goal:** per-locale experience content; one-click AI translation as a draft for human review.
- **Touches:** experience `templateContent` shape, editor UI, an LLM service in the API.
- **Open questions:** which languages; does the screen pick the locale or the visitor?

### 8. Mixed-content whiteboard canvas
- **Today:** drawing only — pen, line, rect, circle, eraser ([whiteboard-canvas.ts](../apps/cms/src/lib/whiteboard-canvas.ts)).
- **Goal:** place images, PDFs, video and sticky notes on the board; move/resize them.
- **Touches:** `WhiteboardTool` + page data in `whiteboard_document.pages`, reuse media library assets.

### 9. Video conferencing
- **Today:** no Zoom / Teams / Meet / Webex.
- **Goal:** start or join a call on a room screen with a camera, alongside shared content.
- **Open questions:** existing room hardware (Teams Room / Zoom Room)? Integrate with it or launch the web client on the screen?

### 10. Span content across displays / video wall
- **Today:** every screen is independent.
- **Goal:** group screens into a wall; one experience or canvas stretches across them, kept in sync.
- **Touches:** screen grouping in the screens schema, [playback-sync.ts](../packages/ui/src/lib/playback-sync.ts), WS gateway.

### 11. Third-party integrations
- **Today:** Gmail attachments and Drive links only ([gmail-ingest.ts](../apps/api/src/services/gmail-ingest.ts)).
- **Goal:** import from Microsoft 365 / OneDrive; show Canva, Figma and Miro boards on screens.
- **Touches:** ingestion service following the Gmail pattern; embeds via [HtmlRenderer](../apps/cms/src/app/display/_components/HtmlRenderer.tsx).

---

## P3 — Later

### 12. AI content assistance
- **Today:** no generative AI (our AI is camera recognition only).
- **Goal:** draft welcome messages and descriptions, summarise decks, auto-describe uploaded media — always as drafts.

### 13. Semantic media search
- **Today:** no search by meaning in the media library.
- **Goal:** "find the video about the airport project" returns the right assets.
- **Touches:** pgvector is already installed for face matching (see [services/vision](../services/vision/README.md)) — reuse for media embeddings.

### 14. Multi-site management
- **Today:** one stack per location.
- **Goal:** manage several offices' screens and content from one CMS.
- **Open questions:** only relevant if the client has more than one site.

### 15. No-code content blocks
- **Today:** every new template needs a developer.
- **Goal:** editors assemble pages from a library of reusable blocks.
- **Open questions:** worth it only if clients need layouts our templates don't cover.

---

## Out of scope

Website-only concerns from FocusReactive that don't apply to a screen platform: SEO & structured
data, Core Web Vitals, e-commerce storefronts, CMS migrations, marketing/GTM integrations, GDPR
cookie components.
