import React from "react";
import { Lightbulb, Radar, Pipette, ChevronDown } from "lucide-react";
import { Badge } from "@platform/ui";
import { Switch, DragSlider } from "./controls";
import { Flame, Palette } from "lucide-react";
import { LIGHT_PRESETS, groupLights } from "@/lib/casambi-lights";
import AmbientModesPanel from "./ambient-modes-panel";
import { SampleBadge } from "../../_components/dashboard/sample-badge";

/**
 * One row per fixture group, expandable to the individual fixtures underneath.
 *
 * Fixtures sharing a name collapse into one row — "Stretch Fabric 0" and
 * "Stretch Fabric 1" become a single "Stretch Fabric" control driving both —
 * with a chevron to open them for individual control. See groupLights().
 *
 * Colour: a fixture only renders colour when its White/Colour balance is on the
 * colour side. That balance is NOT settable over the gateway's MQTT interface —
 * only the Casambi app and scenes change it — so where a fixture is in white
 * mode the colour row says so rather than offering a control that does nothing.
 */

type Row = { uuid: string; deviceId: string; name: string; status: string; state?: { colorBalance?: number } };

/** Below this the fixture is rendering its white LEDs and will ignore RGB. */
const COLOUR_MODE_MIN = 32;

/**
 * Shown while no Casambi fixtures are registered, so the card keeps its real
 * layout instead of an empty state. Mirrors the roster in
 * apps/api/src/scripts/seed-casambi-devices.ts. Controls are inert for these.
 */
const PLACEHOLDER_LIGHTS: Row[] = [
  { uuid: "placeholder-23", deviceId: "casambi-light-23", name: "Strip Light", status: "offline" },
  { uuid: "placeholder-27", deviceId: "casambi-light-27", name: "Stretch Fabric 0", status: "offline" },
  { uuid: "placeholder-28", deviceId: "casambi-light-28", name: "Stretch Fabric 1", status: "offline" },
];

const NOOP_ACTIONS = {
  setPower: () => {},
  setBrightness: () => {},
  setColor: () => {},
  setMode: () => {},
  identify: () => {},
  openColourPanel: () => {},
  modeApplied: () => {},
};

const inColourMode = (r: Row) => (r.state?.colorBalance ?? 0) >= COLOUR_MODE_MIN;

function StatusDot({ members }: { members: Row[] }) {
  const online = members.filter((m) => m.status === "online").length;
  const tone = online === members.length ? "bg-emerald-500" : online > 0 ? "bg-amber-500" : "bg-red-500";
  const label = online === members.length ? "Reachable"
    : online > 0 ? `Only ${online} of ${members.length} reachable` : "Not reachable";
  return <span title={label} className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />;
}

/**
 * Segmented Warm | Colour switch, shown only for groups whose mode is changed
 * by recalling a Casambi scene. RGB-only fixtures have no mode to be in.
 */
function ModeToggle({ mode, onMode }: { mode: "warm" | "colour"; onMode: (m: "warm" | "colour") => void }) {
  // Solid fill on the active side, not a faint tint — at this size a 20%
  // background was too easy to miss, and which mode you are in decides whether
  // the colour swatches do anything at all.
  // Two separate pills rather than a bordered segmented control: the active
  // one carries a solid fill, the inactive one a flat muted ground, so the
  // state reads without any surrounding chrome.
  const base =
    "flex h-6 shrink-0 items-center gap-1 rounded-full px-3 text-[9px] font-bold uppercase tracking-widest transition-all";
  const idle = "btn-surface";
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        title="Warm white — the fixture's own white LEDs"
        aria-pressed={mode === "warm"}
        onClick={(e) => { e.stopPropagation(); onMode("warm"); }}
        className={`${base} ${mode === "warm" ? "btn-active" : idle}`}
      >
        <Flame className="h-2.5 w-2.5" />
        Warm
      </button>
      <button
        type="button"
        title="Colour mode — unlocks the swatches"
        aria-pressed={mode === "colour"}
        onClick={(e) => { e.stopPropagation(); onMode("colour"); }}
        className={`${base} ${mode === "colour" ? "btn-active" : idle}`}
      >
        <Palette className="h-2.5 w-2.5" />
        Colour
      </button>
    </div>
  );
}

/**
 * Colour swatches, plus the mode switch for scene-based groups.
 *
 * In warm mode the swatches are greyed and inert rather than hidden, so the row
 * keeps its height when toggling and it stays obvious that colours exist. They
 * are disabled rather than auto-switching because a fixture in warm mode
 * ignores RGB outright — a tappable swatch there would do nothing at all.
 */
function ColourRow({
  mode,
  onPick,
  onCustom,
  onMode,
}: {
  mode: "warm" | "colour";
  onPick: (hex: string) => void;
  onCustom: () => void;
  onMode: (m: "warm" | "colour") => void;
}) {
  // Every fixture gets the same Warm | Colour toggle and the same locking, so
  // the card behaves identically everywhere. What differs is only HOW the mode
  // is applied, which the container decides: scene-based groups recall a
  // Casambi scene, RGB-only fixtures just take a warm-white colour. That
  // difference is deliberate and must not be "made consistent" — a scene is
  // network-wide, so routing the Strip Light through one would let its Warm
  // button move the fabric panels, which is the bug this replaced.
  const locked = mode === "warm";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <ModeToggle mode={mode} onMode={onMode} />

      <div
        className={`flex flex-wrap items-center gap-1.5 ${locked ? "pointer-events-none opacity-40" : ""}`}
        title={locked ? "Switch to Colour to use these" : undefined}
        aria-disabled={locked}
      >
        {LIGHT_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            title={p.name}
            aria-label={p.name}
            onClick={(e) => { e.stopPropagation(); onPick(p.hex); }}
            className="h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110 dark:border-white/20"
            style={{ backgroundColor: p.hex }}
          />
        ))}
        <button
          type="button"
          title="Custom colour"
          aria-label="Custom colour"
          onClick={(e) => { e.stopPropagation(); onCustom(); }}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Pipette className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function Dimmer({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        Dim
      </span>
      <div className="min-w-0 flex-1">
        <DragSlider value={value} onChange={onChange} max={100} />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] font-black tabular-nums">{value}%</span>
    </div>
  );
}

export default function LightingContent({ isExpanded, state, actions: liveActions }: any) {
  const isPlaceholder = (state.lights ?? []).length === 0;
  const lights: Row[] = isPlaceholder ? PLACEHOLDER_LIGHTS : state.lights;
  // Never send commands for the placeholder fixtures.
  const actions = isPlaceholder ? NOOP_ACTIONS : liveActions;
  const groups = groupLights(lights);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  // Optimistic mode wins while it exists; otherwise fall back to what the
  // fixtures last reported, so a reload still shows the true mode.
  const modeOf = (g: { name: string; members: Row[] }): "warm" | "colour" =>
    state.modes?.[g.name] ?? (g.members.some(inColourMode) ? "colour" : "warm");

  const onCount = groups.filter((g) => g.members.some((m) => state.on?.[m.uuid])).length;
  const anyOn = onCount > 0;

  return (
    <div className="flex flex-col h-full z-10 relative text-card-foreground">
      <div className={`flex justify-between items-start shrink-0 ${isExpanded ? "mb-4" : "mb-2"}`}>
        <div className="flex items-center gap-2">
          <div className={`${isExpanded ? "w-8 h-8" : "w-7 h-7"} rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0`}>
            <Lightbulb className={isExpanded ? "w-4 h-4" : "w-3.5 h-3.5"} />
          </div>
          <h3 className={`${isExpanded ? "text-lg" : "text-base"} font-semibold tracking-tight`}>Lighting</h3>
        </div>
        <div className={`flex items-center ${isExpanded ? "gap-3" : "gap-2"}`}>
          {isPlaceholder && <SampleBadge title="No Casambi lights registered — placeholder fixtures" />}
          <Badge variant="secondary" className={`${isExpanded ? "" : "hidden xl:inline-flex"} border-0 bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-slate-300 shadow-none font-bold uppercase text-[10px] tracking-widest`}>
            {groups.length === 0 ? "None" : `${onCount}/${groups.length} On`}
          </Badge>
          <Switch checked={anyOn} onChange={(on: boolean) => actions.setPower?.(lights.map((l) => l.uuid), on)} />
        </div>
      </div>

      {!isExpanded ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <span className="text-3xl font-black md:text-[2rem] leading-none">
            {groups.length === 0 ? "—" : `${onCount}/${groups.length}`}
          </span>
          <span className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {groups.length === 1 ? "Light On" : "Lights On"}
          </span>
        </div>
      ) : (
              <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
        <AmbientModesPanel onApplied={actions.modeApplied} />
        {groups.map((g) => {

            const uuids = g.members.map((m) => m.uuid);
            const on = g.members.some((m) => state.on?.[m.uuid]);
            const offline = g.members.every((m) => m.status === "offline");
            const many = g.members.length > 1;
            const isOpen = !!open[g.name];
            return (
              // Offline fixtures dim but stay interactive — the gateway's online
              // flag has proven unreliable, so it must not lock out a light the
              // user can actually still reach.
              <div
                key={g.name}
                className={`rounded-2xl border border-border p-3 transition-opacity ${offline ? "opacity-50" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusDot members={g.members} />
                    <span className="truncate text-[11px] font-bold uppercase tracking-widest">{g.name}</span>
                    {many && (
                      <button
                        type="button"
                        title={isOpen ? "Hide individual drivers" : "Control drivers individually"}
                        onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [g.name]: !o[g.name] })); }}
                        className="flex shrink-0 items-center gap-0.5 rounded bg-black/5 px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
                      >
                        {g.members.length}
                        <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      title={`Flash ${g.name} to see which fixture it is`}
                      onClick={(e) => { e.stopPropagation(); actions.identify?.(uuids); }}
                      className="flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 text-[8px] font-bold uppercase text-muted-foreground transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
                    >
                      <Radar className="h-2.5 w-2.5" />
                      Identify
                    </button>
                    <Switch checked={on} onChange={(v: boolean) => actions.setPower?.(uuids, v)} />
                  </div>
                </div>

                <div className="mt-2.5">
                  <Dimmer
                    value={Math.max(...g.members.map((m) => state.brightness?.[m.uuid] ?? 0), 0)}
                    onChange={(v) => actions.setBrightness?.(uuids, v)}
                  />
                </div>

                <div className="mt-2">
                  <ColourRow
                    mode={modeOf(g)}
                    onPick={(hex) => actions.setColor?.(uuids, hex)}
                    onCustom={() => actions.openColourPanel?.(uuids, g.name)}
                    onMode={(m) => actions.setMode?.(g.name, uuids, m)}
                  />
                </div>

                {many && isOpen && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                    {g.members.map((m) => (
                      <div key={m.uuid} className="rounded-xl bg-black/[0.03] p-2.5 dark:bg-white/[0.04]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <StatusDot members={[m]} />
                            <span className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{m.name}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              title={`Flash ${m.name}`}
                              onClick={(e) => { e.stopPropagation(); actions.identify?.([m.uuid]); }}
                              className="flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 text-[8px] font-bold uppercase text-muted-foreground transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
                            >
                              <Radar className="h-2.5 w-2.5" />
                              ID
                            </button>
                            <Switch checked={!!state.on?.[m.uuid]} onChange={(v: boolean) => actions.setPower?.([m.uuid], v)} />
                          </div>
                        </div>
                        <div className="mt-2">
                          <Dimmer
                            value={state.brightness?.[m.uuid] ?? 0}
                            onChange={(v) => actions.setBrightness?.([m.uuid], v)}
                          />
                        </div>
                        <div className="mt-2">
                          <ColourRow
                            mode={modeOf(g)}
                            onPick={(hex) => actions.setColor?.([m.uuid], hex)}
                            onCustom={() => actions.openColourPanel?.([m.uuid], m.name)}
                            onMode={(mm) => actions.setMode?.(g.name, uuids, mm)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
