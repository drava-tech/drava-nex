"use client";

import React from "react";
import { Pencil, Pipette } from "lucide-react";
import { Switch, DragSlider } from "./controls";
import { LIGHT_PRESETS, WARM_WHITE_HEX } from "@/lib/casambi-lights";
import {
  listAmbientModes,
  saveAmbientMode,
  applyAmbientMode,
  type AmbientModeSummary,
} from "@/actions/ambient-mode-actions";

/**
 * Whole-room lighting modes: tap one to put every light into it, or open its
 * editor to choose the colour (from the palette, or any custom colour), the
 * brightness, and whether the strip light takes part. TRAVIS applies the very
 * same saved modes by voice ("Travis, meeting mode"), so what is saved here is
 * what he sets.
 *
 * Colour rule (enforced server-side, see apps/api/src/services/ambient-modes.ts):
 * whites (Warm White, Neutral White) use the fixtures' own white LEDs; any
 * other colour switches them to their colour LEDs first.
 */

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

export default function AmbientModesPanel({
  onApplied,
}: {
  /** Called after a mode reaches the lights, so the fixtures below can refresh. */
  onApplied?: (mode: AmbientModeSummary) => void;
}) {
  const [modes, setModes] = React.useState<AmbientModeSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Omit<AmbientModeSummary, "key" | "label"> | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<{ text: string; error?: boolean } | null>(null);

  React.useEffect(() => {
    listAmbientModes()
      .then(setModes)
      .catch((err) => {
        console.error("Failed to load ambient modes:", err);
        setLoadFailed(true);
      });
  }, []);

  const apply = async (mode: AmbientModeSummary) => {
    setBusy(mode.key);
    setNotice(null);
    try {
      const result = await applyAmbientMode(mode.key);
      setActiveKey(mode.key);
      // Success shows on the tile itself; only a partial failure needs words.
      if (result.failed > 0) {
        setNotice({
          text: `${mode.label} set — ${result.failed} light${result.failed === 1 ? "" : "s"} didn't respond.`,
          error: true,
        });
      }
      onApplied?.(mode);
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "Couldn't set the mode.", error: true });
    } finally {
      setBusy(null);
    }
  };

  const openEditor = (mode: AmbientModeSummary) => {
    setEditing(mode.key);
    setDraft({ color: mode.color, brightness: mode.brightness, stripOn: mode.stripOn });
    setNotice(null);
  };

  const save = async () => {
    if (!editing || !draft) return;
    setSaving(true);
    try {
      const updated = await saveAmbientMode(editing, draft);
      setModes((prev) => prev?.map((m) => (m.key === updated.key ? updated : m)) ?? prev);
      setNotice({ text: `${updated.label} saved. Tap it to apply.` });
      setEditing(null);
      setDraft(null);
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "Couldn't save.", error: true });
    } finally {
      setSaving(false);
    }
  };

  const editingMode = modes?.find((m) => m.key === editing) ?? null;

  return (
    <div className="mt-auto shrink-0">
      {loadFailed ? (
        <p className="text-[11px] text-muted-foreground/70">Couldn&apos;t load the modes.</p>
      ) : modes === null ? (
        <p className="text-[11px] text-muted-foreground/70">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {modes.map((m) => {
            const isActive = activeKey === m.key;
            return (
              <div
                key={m.key}
                className={`relative flex flex-col gap-1.5 rounded-xl border p-2.5 transition-colors ${
                  isActive ? "btn-active border-transparent" : "border-border bg-accent shadow-[var(--pill-shadow)]"
                }`}
              >
                {/* data-plain: opts out of the global "every button with a gap-* class gets a
                    violet pill outline" rule (packages/ui/src/globals.css), which was drawing
                    a second border inside the card. */}
                <button
                  type="button"
                  data-plain
                  disabled={busy !== null}
                  onClick={(e) => { e.stopPropagation(); void apply(m); }}
                  className="flex flex-col items-start gap-1.5 text-left disabled:opacity-60"
                  aria-label={`Set ${m.label} mode`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 dark:border-white/20"
                      style={{ backgroundColor: m.color }}
                    />
                    <span className="text-[11px] font-black uppercase tracking-wider">
                      {busy === m.key ? "Setting…" : m.label}
                    </span>
                  </span>
                  <span className={`text-[10px] font-semibold ${isActive ? "text-white/75" : "text-muted-foreground"}`}>
                    {m.brightness}%{m.stripOn ? "" : " · strip off"}
                  </span>
                </button>
                <button
                  type="button"
                  title={`Edit ${m.label}`}
                  aria-label={`Edit ${m.label}`}
                  onClick={(e) => { e.stopPropagation(); openEditor(m); }}
                  className={`absolute right-1.5 top-1.5 rounded p-1 transition-colors ${
                    isActive
                      ? "text-white/75 hover:bg-white/15 hover:text-white"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                  }`}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {notice && (
        <p className={`mt-1.5 truncate text-[10px] font-semibold ${notice.error ? "text-red-500" : "text-muted-foreground"}`}>
          {notice.text}
        </p>
      )}

      {editingMode && draft && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Edit {editingMode.label}
          </span>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Colour palette">
            {LIGHT_PRESETS.map((p) => (
              <button
                key={p.hex}
                type="button"
                title={p.name}
                aria-label={p.name}
                aria-pressed={same(draft.color, p.hex)}
                onClick={(e) => { e.stopPropagation(); setDraft({ ...draft, color: p.hex }); }}
                className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                  same(draft.color, p.hex) ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : "border-black/10 dark:border-white/20"
                }`}
                style={{ backgroundColor: p.hex }}
              />
            ))}
            <label
              title="Custom colour"
              className={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary ${
                LIGHT_PRESETS.some((p) => same(p.hex, draft.color)) ? "" : "ring-2 ring-primary ring-offset-2 ring-offset-card"
              }`}
              style={LIGHT_PRESETS.some((p) => same(p.hex, draft.color)) ? undefined : { backgroundColor: draft.color }}
            >
              <Pipette className="h-3 w-3" />
              <input
                type="color"
                aria-label="Custom colour"
                value={draft.color.toLowerCase()}
                onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              {draft.color.toUpperCase()}
              {same(draft.color, WARM_WHITE_HEX) ? " · warm white" : ""}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Brightness</span>
            <div className="min-w-0 flex-1">
              <DragSlider value={draft.brightness} onChange={(v: number) => setDraft({ ...draft, brightness: v })} max={100} />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] font-black tabular-nums">{draft.brightness}%</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Strip light on</span>
            <Switch checked={draft.stripOn} onChange={(v: boolean) => setDraft({ ...draft, stripOn: v })} />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditing(null); setDraft(null); }}
              className="rounded-full btn-surface px-3 py-1.5 text-[10px] font-normal uppercase tracking-widest transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={(e) => { e.stopPropagation(); void save(); }}
              className="rounded-full btn-primary px-3 py-1.5 text-[10px] font-normal uppercase tracking-widest transition-colors disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
