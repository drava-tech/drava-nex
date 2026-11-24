"use client";

import React, { useRef, useState } from "react";
import { BookOpen, Check, Loader2, RotateCcw, Upload } from "lucide-react";
import { analyseBrandBook, type BrandBookResult, type LogoCandidate } from "./analyse";

export interface BrandBookFields {
  name?: string;
  tagline?: string;
  background?: string;
  accent?: string;
  headingFont?: string;
  bodyFont?: string;
  logoUrl?: string;
}

function loads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), 6000);
    img.onload = () => {
      clearTimeout(t);
      resolve(img.naturalWidth > 0);
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(false);
    };
    img.src = url;
  });
}

/** Saves a cut-out logo to the media library; falls back to embedding it if the API is down. */
async function saveLogo(logo: LogoCandidate, brand: string | null): Promise<{ url: string; saved: boolean }> {
  try {
    const blob = await (await fetch(logo.dataUrl)).blob();
    const fd = new FormData();
    const slug = (brand ?? "brand").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
    fd.append("file", new File([blob], `${slug}-logo.png`, { type: "image/png" }));
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (res.headers.get("content-type")?.includes("application/json")) {
      const data = await res.json();
      // Only use the library copy if this CMS can actually show it — a dev
      // checkout pointed at another host's media (DEV_MEDIA_ORIGIN) can't.
      if (data.success && data.media?.url && (await loads(data.media.url as string))) return { url: data.media.url as string, saved: true };
    }
  } catch {
    /* fall through */
  }
  return { url: logo.dataUrl, saved: false };
}

/**
 * "Upload your brand book": reads a PDF (or a brand sheet image) in the
 * browser and fills the brand panel — name, tagline, colours, fonts, logo —
 * then shows what it found so any pick can be swapped.
 */
export function BrandBookImport({ onApply, onResult }: { onApply: (f: BrandBookFields) => void; onResult?: (r: BrandBookResult | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<BrandBookResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [logoIdx, setLogoIdx] = useState(0);
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickLogo = async (r: BrandBookResult, i: number) => {
    const logo = r.logos[i];
    if (!logo) return;
    setLogoIdx(i);
    const { url, saved } = await saveLogo(logo, r.name);
    setLogoNote(saved ? null : "Couldn't save the logo to the media library, so it's embedded in the design instead.");
    onApply({ logoUrl: url });
  };

  const analyse = async (file: File) => {
    setError(null);
    setResult(null);
    onResult?.(null);
    setFileName(file.name);
    setBusy("Opening the brand book…");
    try {
      const r = await analyseBrandBook(file, setBusy);
      setResult(r);
      onResult?.(r);
      onApply({
        name: r.name ?? undefined,
        tagline: r.tagline ?? undefined,
        background: r.suggestion.background,
        accent: r.suggestion.accent,
        headingFont: r.suggestion.headingFont ?? undefined,
        bodyFont: r.suggestion.bodyFont ?? undefined,
      });
      if (r.logos.length) {
        setBusy("Saving the logo…");
        await pickLogo(r, 0);
      }
    } catch (e) {
      setError(`Couldn't read ${file.name}: ${(e as Error).message || "unknown error"}. Is it a PDF or an image?`);
    } finally {
      setBusy(null);
    }
  };

  const found = result
    ? [
        result.name && "name",
        result.tagline && "tagline",
        result.colours.length && `${result.colours.length} colour${result.colours.length > 1 ? "s" : ""}`,
        result.fonts.length && `${result.fonts.length} font${result.fonts.length > 1 ? "s" : ""}`,
        result.logos.length && "logo",
      ].filter(Boolean)
    : [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-violet-500/40 bg-violet-500/[0.03] p-3">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void analyse(f);
        }}
      />
      <div className="flex items-center gap-3">
        <BookOpen className="h-5 w-5 shrink-0 text-violet-500" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
            {result ? `Read from ${fileName}` : "Have a brand book?"}
          </p>
          <p className="truncate text-[11px] text-zinc-500">
            {busy ??
              (result
                ? found.length
                  ? `Found ${found.join(", ")} · ${result.pages} page${result.pages > 1 ? "s" : ""}`
                  : "Nothing usable found — fill the brand in below."
                : "Upload the PDF and we'll fill in the name, colours, fonts and logo. It's read on this computer and never leaves it.")}
          </p>
        </div>
        <button
          type="button"
          data-plain
          disabled={!!busy}
          onClick={() => input.current?.click()}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-[11px] font-medium hover:bg-accent disabled:opacity-60 dark:bg-zinc-900"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : result ? <RotateCcw className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
          {result ? "Another" : "Upload brand book"}
        </button>
      </div>

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      {result && !busy && (
        <div className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2">

          {result.fonts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Fonts</span>
              {result.fonts.map((f) => (
                <div key={f.family} className="flex flex-col">
                  <span className="truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
                    {f.family} {f.role !== "other" && <span className="font-normal text-zinc-500">· {f.role}</span>}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    shown as {f.mappedLabel}
                    {" · "}
                    <button type="button" data-plain onClick={() => onApply({ headingFont: f.mapped })} className="underline hover:text-violet-500">
                      heading
                    </button>
                    {" / "}
                    <button type="button" data-plain onClick={() => onApply({ bodyFont: f.mapped })} className="underline hover:text-violet-500">
                      body
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {result.logos.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Logo</span>
              <div className="flex flex-wrap gap-1.5">
                {result.logos.map((l, i) => (
                  <button
                    key={i}
                    type="button"
                    data-plain
                    onClick={() => void pickLogo(result, i)}
                    title={`From page ${l.page}`}
                    className={`relative flex h-12 w-16 items-center justify-center rounded border bg-[repeating-conic-gradient(#e4e4e7_0_25%,#fff_0_50%)] bg-[length:10px_10px] p-1 ${
                      logoIdx === i ? "border-violet-500" : "border-border hover:border-zinc-400"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.dataUrl} alt={`Logo option ${i + 1}`} className="max-h-full max-w-full object-contain" />
                    {logoIdx === i && <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-violet-500 p-0.5 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
              {logoNote && <p className="text-[10px] leading-snug text-amber-600">{logoNote}</p>}
            </div>
          )}

          {result.notes.length > 0 && (
            <ul className="col-span-full flex flex-col gap-0.5 text-[10.5px] leading-snug text-zinc-500">
              {result.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The brand book's own colours, each settable as the background or the
 * accent. Replaces the preset palettes once a book has been read, so a click
 * can only ever pick one of the brand's colours.
 */
export function BrandSwatches({
  colours,
  background,
  accent,
  onPick,
}: {
  colours: BrandBookResult["colours"];
  background: string;
  accent: string;
  onPick: (f: { background?: string; accent?: string }) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colours.map((c) => (
        <div key={c.hex} className="flex w-[52px] flex-col items-center gap-1" title={`${c.label ?? c.hex}${c.source === "measured" ? " (measured from the pages)" : ""}`}>
          <span className="h-7 w-full rounded border border-border" style={{ background: c.hex }} />
          <span className="w-full truncate text-center font-mono text-[9px] text-zinc-500">{c.label ?? c.hex}</span>
          <span className="flex w-full gap-0.5">
            {(
              [
                ["BG", "background", background],
                ["Acc", "accent", accent],
              ] as const
            ).map(([lbl, key, current]) => {
              const on = current.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={key}
                  type="button"
                  data-plain
                  aria-pressed={on}
                  aria-label={`Use ${c.hex} as ${key}`}
                  onClick={() => onPick({ [key]: c.hex })}
                  className={`h-4 flex-1 rounded-sm text-[8.5px] font-semibold ${on ? "bg-violet-500 text-white" : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300"}`}
                >
                  {lbl}
                </button>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
