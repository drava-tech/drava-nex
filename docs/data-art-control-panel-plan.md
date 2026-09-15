# DATA ART control panel in Broadcast → Live

> Status: **built and deployed to the LAN stack 2026-09-12.** Kept as the design
> record; the "As built" section at the end lists where the implementation
> deviated from this plan.

## Context

The Flight Garden template ([`flight-garden.js`](../packages/ui/src/templates/flight-simulation/engine/flight-garden.js), ~4000 lines) already renders everything we want on the wall: the WebGL garden, the butterflies, the HUD, and live wind/attendance feeds driving playback rate and hue. Its problem is the **control surface** — the only way to change the visualization is a `<select>` inside its own on-screen HUD, which an operator has to reach through the screen mirror to click.

This change moves that control into the CMS as the supplied **DATA ART** panel, and lifts the artwork out of the scene definition so it becomes a free choice.

The mockup's subtitle is the spec: *"Pick the data to map, and the art to map it onto."* DATA and ART are **independent axes**. Today they are not — each scene in `SCENES` is hard-bound to one `videoId` ([`flight-garden.js:1290`, `:1340`, `:1399`](../packages/ui/src/templates/flight-simulation/engine/flight-garden.js#L1290)).

### Target UI

```
                        DATA ART
                   Choose Your Output
        Pick the data to map, and the art to map it onto.

┌────────┐  ┌──────────────────────────────┐  ┌──────────────┐
│  DATA  │  │ ● Video Preview   ART 6      │  │     ART      │
├────────┤  │            A new garden…     │  ├──────────────┤
│ FLIGHT │  ├──────────────────────────────┤  │ ▣ ART 2 View→│
│WEATHER │  │                              │  │ ▣ ART 3 View→│
│ATTEND. │  │      (art clip preview)      │  │ ▣ ART 4 View→│
└────────┘  │                              │  │ ▣ ART 5 View→│
            │ ▶ 0:00 ──────────────  ⛶ ⋮   │  │ ▣ ART 6 View→│
            └──────────────────────────────┘  └──────────────┘
                        [ GENERATE ]
```

### Decisions taken with the user

| Question | Answer |
|---|---|
| What the TV runs | **Unchanged** — the full WebGL canvas, butterflies, HUD, live data. Only the control moves. |
| Where the art videos come from | The existing private R2 bucket, `flight-simulation/` prefix |
| Where the panel lives | **Broadcast → Live → Main screen**, only when the pushed content is this template |
| What GENERATE does | Every change applies to the wall **live**; GENERATE commits the pair as the saved default |
| Template identity | Keep the template and all its arts — **rename the label only** |

### Assumptions worth flagging

1. **`templateKey` stays `"flight-simulation"`.** Only the user-facing label becomes "Data Art". Renaming the key means migrating every `experience.templateKey` row plus `packages/db/src/migrate-experience-template.ts`; the label is what is actually seen.
2. **ART 2–6 do not exist in R2 yet.** Only `flight-garden` and `weather-warm` are allowlisted ([`flight-video.ts:130`](../apps/api/src/services/flight-video.ts#L130)). The catalog below defines the ids and expected object names; the MP4s need uploading before those tiles play. Until then they render dimmed.
3. **The weather scene's hue tint is relative to its clip's own colour.** The thermal anchors are documented as offsets from the source render's native red, `0 turns` = untouched ([`flight-garden.js:1315-1337`](../packages/ui/src/templates/flight-simulation/engine/flight-garden.js#L1315)). Map WEATHER onto a green or purple render and every temperature band lands on the wrong colour. Handled below by giving each catalog entry a `nativeHueTurns` the anchors are rebased against — the one genuinely fiddly part of making the axes independent.

---

## 1 · Lift the artwork out of the scenes

Today `activateScene` reads the clip straight off `scene.art.videoId`. It needs an override layer: a currently-selected art id that defaults to the scene's own but can be replaced from the CMS.

**`packages/ui/src/templates/flight-simulation/art-catalog.ts`** (new, browser-safe — **no R2 keys**, this ships to the browser):

```ts
export const DATA_SOURCES = ["flight", "weather", "attendance"] as const;  // = SCENES keys
export type DataSource = (typeof DATA_SOURCES)[number];

export interface ArtEntry {
  id: string;              // "flight-garden", "art-2", …
  label: string;           // "ART 2"
  blurb: string;           // "A new garden render"
  thumbnail: string;       // /media/flight-garden/art/art-2.jpg
  nativeHueTurns?: number; // source hue, for rebasing the thermal anchors (default 0 = red)
}

export const ART_CATALOG: ArtEntry[];
export const DEFAULT_ART_ID = "flight-garden";
```

A flat list — every art is offerable to every data source, per the mockup subtitle.

**`flight-garden.js` changes:**

| What | Where | Change |
|---|---|---|
| `VIDEO_PATHS` | line 1141 | Derive from `ART_CATALOG` instead of a second hand-kept copy. It only matters when `R2_PUBLIC_BASE` is set (empty by default), but two lists that must agree is one too many. |
| `selectedArtId` | new module state | Defaults to the active scene's `art.videoId`. |
| `activateScene` | line 1957 | Resolve the clip as `selectedArtId ?? scene.art.videoId`. |
| `sceneVideoIds` | line 1465 | Include the selected art so prefetching warms the right clip. |
| `setThermalTint` | — | Rebase the anchors by the active art's `nativeHueTurns`, so WEATHER on any render still reads Freezing→blue, Extreme→magenta. |
| `setArt(artId)` | new handle method | On `FlightGardenHandle` ([`engine/types.ts:71-102`](../packages/ui/src/templates/flight-simulation/engine/types.ts#L71-L102)). Swaps the plane's video through the existing `setGardenVideo` (line 1754), which already has the load-failure fallback chain. |
| `currentView()` / `applyView` | line 3879 | Carry and honour `artId`, guarded like every other field so the gateway's echo costs nothing. |

> `applyView` must apply the art **after** the awaited `switchScene`, alongside `applyFeed` — otherwise `activateScene` overwrites it.

Everything else in the engine — butterflies, HUD, feeds, veil cut — is untouched.

## 2 · The video allowlist and catalog route

**[`apps/api/src/services/flight-video.ts:130`](../apps/api/src/services/flight-video.ts#L130)** — extend `VIDEO_KEYS` with the new ids → R2 keys (`art-2` → `flight-simulation/art_2.mp4`, …). The file header's rule stands: this is the security boundary, ids in / keys out, never the reverse. Adding a future art = one line here, one in the catalog, one upload.

**[`apps/api/src/routes/flight-simulation.ts`](../apps/api/src/routes/flight-simulation.ts)** — add `GET /arts`, returning the catalog with an `available` flag per entry (is the id in `VIDEO_KEYS`), so the panel can dim slots whose MP4 has not landed. Public, like the rest of that router.

Thumbnails: committed stills in `apps/cms/public/media/flight-garden/art/`, beside the existing `garden.png` fallback.

## 3 · Content + live-view shape

**[`packages/ui/src/templates/flight-simulation/content.ts`](../packages/ui/src/templates/flight-simulation/content.ts)** — add to `FlightSimulationContent`, to `DEFAULT_FLIGHT_SIMULATION_CONTENT`, and to the coercion block in `readFlightSimulationContent` (line 49) so a hand-edited value can never reach the engine:

```ts
dataSource: DataSource;  // default "flight"  → the scene the garden opens on
artId: string;           // default "flight-garden"
```

**[`engine/types.ts:60`](../packages/ui/src/templates/flight-simulation/engine/types.ts#L60)** — add optional `artId` to `FlightGardenView` (it already carries `sceneId`).

**[`flight-simulation-canvas.tsx`](../packages/ui/src/templates/flight-simulation/flight-simulation-canvas.tsx)** — pass the authored `artId` into the engine on boot and via a `setArt` effect, following the existing imperative-update pattern at `:127-159`; adopt it from `latestView` on a slow chunk load (`:106`).

Reuse the existing **`SET_FLIGHT_VIEW`** command rather than inventing one — it is wired end to end and needs no gateway or player change:

- relay: [`LiveScreenPlayer.tsx:218-223`](../apps/cms/src/app/display/_components/LiveScreenPlayer.tsx#L218-L223) → replayable `flight-set-view`, cleared on `RESET_STATE` at `:251`
- replay after reconnect: `sendViewStateTo` in [`gateway.ts:295-308`](../apps/api/src/ws/gateway.ts#L295-L308)
- send from CMS: `sendRemoteCommand(screenId, "SET_FLIGHT_VIEW", view)` — [`screen-actions.ts:67`](../apps/cms/src/actions/screen-actions.ts#L67)

The HUD keeps emitting `onViewChange` ([canvas `:65-70`](../packages/ui/src/templates/flight-simulation/flight-simulation-canvas.tsx#L65)), so touching the wall directly still keeps the CMS panel in sync — the relay is bidirectional and already echo-safe.

**No change to [`ContentRenderer.tsx:127-131`](../apps/cms/src/app/display/_components/ContentRenderer.tsx#L127-L131) or `ownsReadySignal`** — the wall still renders `FlightSimulationRenderer`.

## 4 · Plumb `templateKey` to the Live surface

The value is already in `WsContent` and already resolved by `getScreenContent`; it is just narrowed away. Three widenings:

- [`useScreenControls.ts:34, :74`](../apps/cms/src/hooks/useScreenControls.ts#L74) — add `templateKey` to the `onContentUpdated` payload type and pass it through
- [`broadcast/live/[deviceId]/page.tsx:39`](../apps/cms/src/app/(dashboard)/broadcast/live/[deviceId]/page.tsx#L39) — include `templateKey` in `initialContent`, plus the screen's `currentExperienceId` so GENERATE knows what to save
- [`live-screen-surface.tsx:76`](../apps/cms/src/components/live-screen-surface.tsx#L76) — widen `LiveScreenSurfaceProps.initialContent`, add optional `experienceId`

## 5 · The panel

**`apps/cms/src/components/data-art-control-panel.tsx`** (new), mounted as a new branch in the existing content-type chain at [`live-screen-surface.tsx:483-512`](../apps/cms/src/components/live-screen-surface.tsx#L483-L512), before the generic `ScreenMirror` fallback:

```tsx
currentContent?.type === "experience" &&
currentContent.templateKey === "flight-simulation"
  ? <DataArtControlPanel screenId={screenId} experienceId={experienceId} />
  : /* existing branches */
```

Lazy-loaded with `next/dynamic` + `ssr:false`, matching the `VideoControlPanel` / `ScreenTouchpad` convention at `:22-42`.

### Layout

A `DATA ART / Choose Your Output` heading over three columns:

- **DATA** (left card) — FLIGHT / WEATHER / ATTENDANCE pills with `lucide-react` icons (`Plane`, `Snowflake`, `CalendarDays`); selected pill inverts to solid dark.
- **Preview** (centre) — header row `● Video Preview │ <ART LABEL> │ <blurb>`, then a native `<video controls>` on `/api/flight-simulation/garden-video?id=<artId>`. The route 302s to a fresh 6h presign per load, so seeking and range requests just work. A flat clip preview, not a second WebGL context — cheap, and exactly what the mockup shows.
- **ART** (right card) — scrollable rows over the whole catalog: thumbnail, label, `View →` (loads it into the centre preview *without* pushing). Selected row inverts; unavailable ids dimmed and non-selectable.
- **GENERATE** centred below.

The full interactive `ScreenMirror` stays reachable behind a small toggle in the panel header, so the operator can still touch the wall directly when they need to.

### Behaviour

- **Any** DATA or ART change → `sendRemoteCommand(screenId, "SET_FLIGHT_VIEW", { sceneId: dataSource, artId })` immediately. The garden does its 300ms veil cut to the new scene/render. Nothing persisted.
- Inbound `SCREEN_UPDATED` / HUD-originated view changes keep the panel's selection in sync.
- **GENERATE** → `updateExperienceTemplateContent(experienceId, "flight-simulation", { …content, dataSource, artId })`, so a cold boot returns to the same pair. Explicit on purpose: that action triggers `repushExperienceToScreens` ([`experiences.ts:57-65`](../apps/api/src/routes/experiences.ts#L57-L65)), a full content transition — firing it on every click would flicker the wall.

### Styling

No shadcn `components/ui` in this repo, so follow the inline-Tailwind idiom of [`audio-content.tsx`](../apps/cms/src/app/(dashboard)/environment/_components/audio-content.tsx) — semantic tokens (`bg-card`, `bg-muted`, `text-muted-foreground`), `rounded-2xl` soft-shadow cards, `motion.button whileTap={{scale:0.95}}` touch feedback. Tokens rather than the mockup's hardcoded off-white, so it stays legible in the dark Live surface.

## 6 · Rename

- [`apps/cms/src/lib/templates.ts:10-18`](../apps/cms/src/lib/templates.ts#L10-L18) — `TEMPLATE_LABELS["flight-simulation"]` → `"Data Art"`
- [`apps/cms/src/templates/definitions.ts:83-89`](../apps/cms/src/templates/definitions.ts#L83-L89) — `label` → `"Data Art"`
- [`editor-workspace.tsx:116`](../apps/cms/src/templates/flight-simulation/editor-workspace.tsx#L116) — the "Flight Simulation" subtitle

---

## Files touched

**New**

- `packages/ui/src/templates/flight-simulation/art-catalog.ts`
- `apps/cms/src/components/data-art-control-panel.tsx`
- `apps/cms/public/media/flight-garden/art/*.jpg` (thumbnails)

**Modified**

- `packages/ui/src/templates/flight-simulation/engine/flight-garden.js`
- `packages/ui/src/templates/flight-simulation/engine/types.ts`
- `packages/ui/src/templates/flight-simulation/content.ts`
- `packages/ui/src/templates/flight-simulation/flight-simulation-canvas.tsx`
- `packages/ui/src/templates/flight-simulation/index.ts` (barrel — export the catalog)
- `apps/api/src/services/flight-video.ts`
- `apps/api/src/routes/flight-simulation.ts`
- `apps/cms/src/hooks/useScreenControls.ts`
- `apps/cms/src/app/(dashboard)/broadcast/live/[deviceId]/page.tsx`
- `apps/cms/src/components/live-screen-surface.tsx`
- `apps/cms/src/lib/templates.ts`
- `apps/cms/src/templates/definitions.ts`
- `apps/cms/src/templates/flight-simulation/editor-workspace.tsx`

---

## Verification

1. **Allowlist + route** — `pnpm --filter @platform/api test`; `curl localhost:3001/api/flight-simulation/arts` (every entry carries `available`); `curl -I "…/garden-video?id=art-2"` → 302 to a presigned URL, and an unknown id must 404 rather than sign.
2. **Art override in the engine** — in the editor preview, switch art on the FLIGHT scene: the plane's video changes, butterflies and HUD keep running, and a failed load falls back per `setGardenVideo` rather than going black.
3. **Thermal rebase** — put WEATHER on a non-red render and step the manual temperature across the bands. Freezing must read blue and Extreme magenta; if they are rotated, `nativeHueTurns` for that entry is wrong.
4. **Live control** — push the experience to `tv-86inch`, open `/broadcast/live/<deviceId>`, click through DATA and ART. Each click should veil-cut the wall within a beat. Check the gateway's `viewport` log lines first — a push to a disconnected screen silently succeeds, so confirm a player is attached before calling a no-change a bug.
5. **Bidirectional sync** — change the scene from the HUD through the mirror; the CMS panel's selection should follow, and must not ping-pong (the echo guards in `switchScene`/`applyView` are what stop that).
6. **Reconnect replay** — reload the display mid-session; `sendViewStateTo` should restore both scene and art with no further clicks.
7. **GENERATE persistence** — hit GENERATE, restart the API container, re-push: the saved pair comes back, not the default.
8. **Regression** — `pnpm typecheck && pnpm lint`; confirm the editor tab and its live preview still work, since `FlightSimulationContent` gained fields.

## Ordering

1. Catalog + `VIDEO_KEYS` + `/arts` route
2. Engine art override, `setArt`, `applyView`
3. Content / view shape
4. `templateKey` plumbing to the Live surface
5. The panel
6. Rename

Steps 1–2 are testable on their own in the editor preview with the two renders that already exist; the panel can then be built against real data.


---

## As built (2026-09-12)

Implemented and deployed. Where it differs from the plan above:

- **The catalog lives in `@platform/types`, not `@platform/ui`.** `apps/api` is a
  Node process and must never import the UI package — that pulls React and
  three.js into the server. The first cut had the API importing
  `@platform/ui/templates/flight-simulation`, which failed typecheck and would
  have broken the API image. `packages/ui/.../art-catalog.ts` is now a thin
  re-export so the template's own modules keep their local import path.
  `@platform/types` is a built package: dependents cannot see a new export until
  `pnpm --filter @platform/types build` has run.

- **`available` is a real bucket probe, not allowlist membership.** An id can be
  reserved in `VIDEO_KEYS` long before anyone uploads the MP4, so checking the
  allowlist reported every unbuilt render as ready and the panel's greying-out
  was cosmetic. `artExists()` now asks R2 directly, cached 60s.
  It uses a **one-byte ranged GET, never a HEAD** — `presignR2Get` signs `"GET"`
  into the canonical request and R2 re-derives the signature from the method
  actually used, so a HEAD against a GET-presigned URL comes back
  SignatureDoesNotMatch and every render reads as missing.

- **The catalog is six entries, not seven.** `weather-warm` is presented as
  ART 2 rather than as a separate "WEATHER WARM" tile, so two of the six slots
  are real renders today and only ART 3–6 await uploads.

- **GENERATE spreads the whole authored slice.** `mergeExperienceTemplateContent`
  merges at the *template-key* level and replaces the slice wholesale, so saving
  just `{ dataSource, artId }` silently reset the airport, tower label, HUD
  toggles, speed and refresh interval. The panel now writes
  `{ ...authored, dataSource, artId }`.

- **`templateContent` is plumbed to the panel**, not just `templateKey`. Without
  it the panel always opened on FLIGHT / ART 1 regardless of what the wall was
  showing, and had nothing to preserve on save.

- **`applyView` sets the art before the scene cut.** `activateScene` resolves the
  clip from `selectedArtId`, so applying the art afterwards loaded the *previous*
  render first and flashed it behind the veil before loading the right one.

- **Not done:** art thumbnails. `apps/cms/public/media/flight-garden/art/` does
  not exist yet, so the panel lists arts by label and blurb rather than showing
  the mockup's thumbnail strip. The catalog already carries the paths.

- **Not done:** the ScreenMirror toggle in the panel header. For this template
  the panel replaces the mirror outright.

### Still needed from the user

Upload `art_3.mp4` … `art_6.mp4` to the R2 bucket under `flight-simulation/`.
They are already allowlisted, so they light up on their own within 60s — no
redeploy. Add the thumbnails under `apps/cms/public/media/flight-garden/art/`
(baked into both images, so that one does need a rebuild).
