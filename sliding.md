# Drag-to-Publish: swipe/drag content onto a screen from a tablet

## Context

Today, pushing content to a screen requires opening a modal (`ScreenAssignmentPicker` or
`PushToScreenModal`), picking a screen from a checkbox list, and tapping "Push." The user wants a
faster, tablet-native motion: **drag any piece of content (experience or media) up onto a header box
showing the target screen, and it auto-publishes to that screen instantly** — no modal, no checkbox
list. The header box also has left/right arrows so the target screen can be switched without leaving
the page, so one tablet session can rapid-fire content to several screens in a row.

This confirmed design (from the user, via preview mockups): a fixed **screen drop-zone** at the top
(screen name + "now showing" subtitle + prev/next arrows), and a **grid of draggable content cards**
below it (experiences + media, freely pickable — not a forced one-at-a-time deck). Dropping a card on
the box publishes it to whichever screen the box currently shows.

No new backend or realtime work is needed — `assignExperience`/`assignMedia`
(`apps/cms/src/actions/screen-actions.ts`) already write the DB and broadcast over the WS gateway to
the physical screen in real time ([[project_realtime_ws]] in memory). This is purely a new
interaction layer on top of that existing, proven push path.

## Approach

### 1. Give experiences a cover image (small, targeted query change)

`apps/cms/src/actions/project-actions.ts:39` `getExperiences()` currently calls the shared
`listExperiences()` query (`packages/db/src/queries/experiences.ts:7`), which returns only
`{id, title}` — that query is also used by the **public** `GET /api/experiences` route
(`apps/api/src/routes/experiences.ts:28`), so it must not be widened with template JSON.

Instead, change `getExperiences()` itself to run its own `db.select()` (same precedent as
`apps/cms/src/app/(dashboard)/experiences/page.tsx:14-19`, which already does this for the same
reason), selecting `templateContent` too, then deriving a cover image with the existing
`extractCoverImage()` helper (`apps/cms/src/lib/extract-cover-image.ts`):

```ts
// apps/cms/src/actions/project-actions.ts
export async function getExperiences(): Promise<{ id: string; title: string; coverImage: string | null }[]> {
  await requireGuestOrAdmin();
  const rows = await db.select({ id: experience.id, name: experience.name, templateContent: experience.templateContent })
    .from(experience).where(isNull(experience.deletedAt))
    .orderBy(asc(experience.position), desc(experience.createdAt));
  return rows.map((r) => ({ id: r.id, title: r.name, coverImage: extractCoverImage(r.templateContent) }));
}
```

Widen the two prop types that consume this shape (both currently `{id: string; title: string}[]` and
both safely ignore an extra field): `ScreensControllerProps.experiences`
(`apps/cms/src/app/(dashboard)/screens/_components/screens-controller.tsx:40`) and
`LiveScreenSurfaceProps.changeContent.experiences` (`apps/cms/src/components/live-screen-surface.tsx:30`).

### 2. New page: `/screens/publish`

- `apps/cms/src/app/(dashboard)/screens/publish/page.tsx` (server component) — mirrors
  `screens/page.tsx`'s data loading: `getScreens()`, `getActiveScreens()`, `getExperiences()`
  (now with `coverImage`). Passes them to a new client component.
- `apps/cms/src/app/(dashboard)/screens/publish/_components/publish-board.tsx` ("use client") — the
  drag board.
- Entry point: add a button next to the existing "+ Add Screen" action in
  `screens-controller.tsx` (which already imports `useRouter`) that navigates to `/screens/publish`.
  Stays inside the normal dashboard shell (sidebar intact) per the user's "existing layout" instruction
  — this is a new page, not a separate kiosk-style route.

### 3. Drag mechanics — reuse `@dnd-kit/core` (already a dependency, already used once in this repo)

`@dnd-kit/core`/`sortable`/`utilities` are already installed and used for the reorderable grid in
`apps/cms/src/app/(dashboard)/experiences/_components/projects-list.tsx` (`DndContext` +
`PointerSensor`). That's the right primitive here too — this is a **draggable-item-onto-a-fixed-target**
interaction, which is exactly what `useDraggable` + `useDroppable` + `DragOverlay` are for (no need for
`framer-motion`'s directional swipe-threshold pattern, and no new dependency).

`PublishBoard` structure:
- `DndContext` (sensors: `PointerSensor` with a small activation distance so taps don't misfire as
  drags) wraps the whole page.
- **Screen drop zone** (top): `useDroppable({ id: "screen-drop-zone" })`. Renders the screen currently
  at `screens[targetIndex]` — name, online dot (from `activeScreenIds`, same as
  `screens-controller.tsx`), and a "now showing: …" line reusing the exported `currentLabel()` helper
  from `apps/cms/src/components/push-to-screen-modal.tsx:93`. Left/right buttons step
  `targetIndex` through the `screens` array (wrapping). Give it an obvious highlight state when
  `isOver` is true (dnd-kit reports this automatically) so the drop target is unmistakable on a tablet.
- **Content grid** (below): each card is `useDraggable({ id: card.id, data: card })`, styled like the
  existing media grid in `screens-assignment-picker.tsx` (thumbnail, title, type badge). Content list =
  `experiences` (prop, with `coverImage`) merged with media fetched client-side from `/api/media`
  (same fetch-on-mount pattern already used in `screens-assignment-picker.tsx:41-55`, filtered to
  `image`/`video`). Small "All / Experiences / Media" filter pills, matching the tab-pill style already
  used in that same picker.
- `DragOverlay` renders the dragged card following the pointer/finger.
- `onDragEnd`: if `over?.id === "screen-drop-zone"`, push the dragged card's content to
  `screens[targetIndex]`:
  ```ts
  if (card.type === "video" || card.type === "image") await assignMedia(screen.screenId, card.id);
  else await assignExperience(screen.screenId, card.id);
  ```
  (same branch `handleAssign` already uses in `live-screen-surface.tsx:86-93` and
  `screens-controller.tsx`.) Optimistically patch the local `screens[targetIndex]` row's
  current-content fields immediately (same optimistic-update approach already used by
  `screens-controller.tsx`'s `handleAssign`), so the "now showing" label updates instantly without
  waiting on `revalidatePath`. Show a small transient confirmation banner ("Pushed 'X' to Lobby TV")
  that auto-clears — no new toast library needed, this repo has none.
  If dropped anywhere else, do nothing; the card just returns to the grid (dnd-kit's default).
- Optionally wire `useCmsScreenSync` (`apps/cms/src/hooks/useCmsScreenSync.ts`, already used in
  `screens-controller.tsx`) so the "now showing" label and online dot stay live if a screen is changed
  from elsewhere while this page is open.

## Verification

- `pnpm dev` from repo root (per [[project_realtime_ws]], never run a second API dev process — the
  root command already starts it).
- Open `/screens/publish` in a browser sized to a tablet viewport (or on the actual tablet), confirm:
  - The drop-zone box shows a real screen name and its current content label.
  - Left/right arrows page through all registered screens.
  - Dragging an experience card and a media card onto the box each trigger a publish, the physical
    screen updates within the existing sub-10ms WS path, and the box's "now showing" label updates.
  - Dropping a card off the zone does nothing (no accidental publish).
- Confirm the existing `/screens` picker flows (`ScreenAssignmentPicker`, `PushToScreenModal`) still
  work unchanged after the `getExperiences()` signature change — they only ever read `id`/`title`.

**Status: shipped.** `getExperiences()`, the `/screens/publish` page, and `PublishBoard` above are
implemented and typecheck-clean (`pnpm --filter @platform/cms typecheck`). Not yet redeployed to the
shared office Docker stack — user wants to verify locally first (`pnpm dev` against the existing
Postgres, published on `5432`, no container rebuild needed).

---

## Follow-up: full-width box + hold-and-swipe-up-to-publish

### Context

After the first version landed, the user asked for two refinements to `PublishBoard`
(`apps/cms/src/app/(dashboard)/screens/publish/_components/publish-board.tsx`):

1. The screen drop-zone (`DropZone`) should be **full width**, not the current centered
   `max-w-md` pill.
2. The gesture itself should change. First attempt (drag a card and release it precisely over the
   box, tracked via `@dnd-kit/core`) was explicitly rejected: **"it's not like a dragging it's like a
   hold and swipe up to the screen and publishing to screen when screen entering open with
   animation."** So this is a **directional swipe gesture with velocity/distance threshold** (touch
   down on a card, swipe it upward, release — the card doesn't need to land on any precise target),
   not a position-tracked drag-and-drop. On a successful swipe-up, the screen box plays an "opening"
   confirmation animation as the content lands.

This is a different enough gesture model that `@dnd-kit/core` (built around rect-collision
drag-and-drop) is no longer the right primitive — swipe-with-threshold is exactly what
**`framer-motion`** (already a dependency, v12.41, currently unused anywhere in `apps/cms/src` —
confirmed via repo-wide grep) is built for. Swap the drag implementation in `publish-board.tsx` from
`@dnd-kit` to `framer-motion`; drop the `@dnd-kit` imports from this file entirely rather than leaving
a half-used mix.

### Approach

**1. Full width + screen-like box (unchanged from before, not part of the rejection).** Drop the
`max-w-md` constraint so `DropZone` fills the row via its existing `flex-1`. Reshape it into an
actual screen-sized surface: `aspect-video`, dark background, embedding the existing `ScreenMirror`
component (`apps/cms/src/app/(dashboard)/screens/_components/screen-mirror.tsx`, already used
identically for live thumbnails in `screens-controller.tsx`'s grid) keyed by
`screens[targetIndex].screenId` as the base layer, with the screen name / online dot / "now showing"
text overlaid the same way the Screens grid overlays its card label over `ScreenMirror`. Remount
`ScreenMirror` (`key={targetScreen.screenId}`) when the arrows change `targetIndex`.

**2. Hold-and-swipe-up gesture, per card.** Each `ContentCard` becomes a `motion.div` with
`drag="y"` (vertical only — this is a swipe *up*, not a free-direction drag), a `useMotionValue` for
its own `y`, and no `dragConstraints` (so it's free to move and springs back on its own). Standard
framer-motion swipe-threshold pattern:
```ts
const y = useMotionValue(0);
const onDragEnd = (_, info: PanInfo) => {
  const swiped = info.offset.y < -SWIPE_DISTANCE || info.velocity.y < -SWIPE_VELOCITY;
  if (swiped) {
    animate(y, -window.innerHeight, { duration: 0.25, ease: "easeIn" });
    triggerPublish(card); // fires assignExperience/assignMedia + the box's opening animation
    setTimeout(() => animate(y, 0, { duration: 0 }), 260); // card is reusable immediately after
  } else {
    animate(y, 0, { type: "spring", stiffness: 400, damping: 30 }); // snap back — no publish
  }
};
```
No hold-then-swipe two-stage timer — "hold" just means the natural press-and-drag contact of a touch
gesture (matches how the rest of the app's touch handling works, e.g. the existing long-press content
picker elsewhere starts from a plain `pointerdown`); a small distance threshold on `drag` start (via
framer-motion's `dragElastic`/built-in slop) is enough to avoid misreading a tap.

**3. `triggerPublish(card)`** replaces `pushCard`'s dnd-kit-triggered call — same body as before
(optimistic screen-row patch, `assignExperience`/`assignMedia`, feedback banner), plus firing the
box's opening animation via a `useAnimationControls()` (framer-motion) held in the parent and passed
down, or a simple `justPublished` state pulse read by the `DropZone`'s own `motion.div` `animate`
prop — e.g. `{ scale: [1, 1.04, 1] }` with a brief glow-ring flash, giving clear "content just landed
here" feedback timed to the actual publish call, not to a continuously-tracked drag position.

**4. Remove:** `@dnd-kit/core` imports (`DndContext`, `useDraggable`, `useDroppable`, `DragOverlay`,
`PointerSensor`, `useSensor`, `useSensors`), the `screen-drop-zone` droppable id, `onDragStart`/
`onDragEnd` DndContext handlers, `activeDragCard` state. Add `framer-motion` imports (`motion`,
`useMotionValue`, `animate`, `useAnimationControls`, `type PanInfo`).

### Verification

- Local run (`pnpm dev`, not the shared Docker stack — see status above).
- On `/screens/publish`: confirm the box spans full width and shows the target screen's live mirror.
- Touch/hold a card and swipe it up past the threshold: confirm it flies off, the actual screen
  updates (existing WS path), the box plays its opening/landing animation, and the card is available
  to swipe again right away.
- A short swipe (below threshold) or a swipe in another direction: confirm the card springs back and
  nothing is published.
- Confirm switching screens with the arrows still shows the correct live mirror and targets the right
  screen for the next swipe.

**Status: shipped.** `publish-board.tsx` rewritten on `framer-motion` (drag="y" per card +
`useAnimation` box flash), `@dnd-kit` fully removed from this file, full-width live-mirror box in
place. Typecheck (`pnpm --filter @platform/cms typecheck`, `noUnusedLocals`/`noUnusedParameters` both
on) passes clean. Not yet tried against the running app — still needs a local `pnpm dev` pass to feel
the actual swipe/animation timing on a touch device before it's called done.

---

# Screen content entrance animation (slide reveal)

## Context

Separate from the `PublishBoard` work above (that's the CMS operator's control-side UI). This is
about the physical TV/tablet **display** itself: right now, whenever new content is pushed to a
screen, `LiveScreenPlayer.tsx` just cuts to a flat 600ms opacity fade
(`.screen-content-fade`, `packages/ui/src/globals.css:229-246`). The user wants a proper
"reveal"/"entering" animation instead of the content just appearing. Confirmed style: **Slide
Reveal** — content slides in (from the bottom) while fading in.

## Approach

Purely a CSS change — no JSX/component edits needed anywhere. Every display-route file
(`apps/cms/src/app/display/_components/LiveScreenPlayer.tsx` and all its content renderers —
`ImageRenderer`, `VideoRenderer`, `StreamRenderer`, `HtmlRenderer`) only ever reference the
**class name** `.screen-content-fade`; nothing references the keyframe name directly (confirmed via
repo-wide grep — only `globals.css` and `LiveScreenPlayer.tsx` mention it, and the latter only uses
the class). So the keyframe body can be redefined in place with zero call-site changes.

`LiveScreenPlayer.tsx` renders `<div key={activeKey} className="screen-content-fade">…</div>`,
remounting this wrapper on every `CONTENT_UPDATE` (image/video/experience/idle all funnel through
it identically — see `useContentPreloader.ts`'s `promote()`). The wrapper is itself
`position: fixed; inset: 0`, and per the existing code comment at `globals.css:230-232`, giving it
a non-default `transform` makes it the containing block for its `position: fixed` children
(every renderer draws `position:fixed; inset:0` internally) — so animating `transform` on the
wrapper visibly slides the actual on-screen content, not just an invisible box.

In `packages/ui/src/globals.css:233-246`, replace the opacity-only keyframe:

```css
@keyframes screen-content-reveal {
  from {
    opacity: 0;
    transform: translateY(48px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.screen-content-fade {
  position: fixed;
  inset: 0;
  animation: screen-content-reveal 700ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

- Class name `.screen-content-fade` stays exactly as-is (zero changes outside this CSS file) —
  only the keyframe's body and name change (renamed to `screen-content-reveal` since it's no
  longer a plain fade).
- `translateY(48px)` (slides up from just below rest position) + `cubic-bezier(0.16, 1, 0.3, 1)`
  (fast-start/slow-settle "arriving" ease) instead of linear `ease-out` — reads as content
  sliding up into place. Distance/duration are easy to retune after seeing it on an actual screen.
- Applies uniformly to every content type and to `IdleDisplay` (same wrapper/class regardless of
  `activeContent.id === "__idle__"` vs real content) — consistent with how the fade already works
  today, just replacing what "how" means.

## Verification

- `pnpm dev` from repo root, open a screen's display route (`/display/<screenId>`).
- Push different content types to that screen (experience, image, video — via `/screens` or
  `/screens/publish`) and confirm each swap now slides up + fades in over ~700ms instead of a
  flat fade.
- Reset the screen to idle and confirm `IdleDisplay` gets the same reveal.
- Check on a 16:9 viewport that the slide doesn't reveal any edge/gap during the animation (the
  fixed `inset:0` wrapper should keep it fully contained, per the existing containing-block
  behavior already relied on for the opacity version).
