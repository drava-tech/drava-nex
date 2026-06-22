"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Loader2, Check, X, ExternalLink, Pencil } from "lucide-react";
import type { Experience } from "@platform/db";
import { assignExperienceTemplate } from "@/actions/experience-actions";
import { isTemplateKey, type TemplateKey } from "@/lib/templates";
import { TEMPLATE_DEFINITIONS, TEMPLATE_OPTIONS } from "./templates/definitions";

export function ExperienceTemplateView({
  experience,
  subpath,
}: {
  experience: Experience;
  subpath: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<TemplateKey>(TEMPLATE_OPTIONS[0]!.key);

  const current = isTemplateKey(experience.templateKey) ? experience.templateKey : null;

  const apply = (key: TemplateKey | null) => {
    setError(null);
    startTransition(async () => {
      const res = await assignExperienceTemplate(experience.id, key);
      if (res.success) router.refresh();
      else setError(res.error ?? "Failed to update template.");
    });
  };

  // ─── No template assigned → show the picker ──────────────────────────────────
  if (!current) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-white/40 dark:bg-white/5 border border-dashed border-zinc-400/40 rounded-2xl mt-4">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900/90 dark:bg-white/90 text-white dark:text-zinc-900 flex items-center justify-center mb-4">
          <LayoutTemplate className="h-5 w-5" />
        </div>
        <h3 className="text-zinc-800 dark:text-zinc-200 font-semibold text-base mb-1">
          Assign a template
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-5">
          Choose a template for <span className="font-medium">{experience.name}</span>. The
          template defines how its content is laid out.
        </p>

        <div className="flex items-center gap-2">
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value as TemplateKey)}
            disabled={isPending}
            className="bg-zinc-100 border border-zinc-300 focus:border-zinc-500 dark:bg-zinc-900 dark:border-zinc-800 dark:focus:border-zinc-600 rounded-xl px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition-colors disabled:opacity-50"
          >
            {TEMPLATE_OPTIONS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => apply(picked)}
            disabled={isPending}
            className="px-5 py-2.5 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white rounded-xl text-xs font-bold tracking-wider uppercase transition-all disabled:opacity-40 flex items-center gap-2"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            <span>Assign</span>
          </button>
        </div>

        {error && <p className="text-xs text-red-500 dark:text-red-400 mt-3">{error}</p>}
      </div>
    );
  }

  // ─── Template assigned → render its layout + a small control bar ─────────────
  const def = TEMPLATE_DEFINITIONS[current];
  const Layout = def.Layout;

  return (
    <div className="flex flex-col gap-4 mt-4">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-white/50 dark:bg-zinc-900/50 border border-zinc-300/50 dark:border-zinc-800/60">
        <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <LayoutTemplate className="h-4 w-4" />
          <span>Template:</span>
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{def.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {def.Workspace && (
            <a
              href={`/edit/experiences/${experience.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold transition-colors"
              title="Edit content in a new tab"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </a>
          )}
          <a
            href={`/preview/experiences/${experience.slug}${subpath.length ? `/${subpath.join("/")}` : ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-semibold hover:opacity-90 transition-opacity"
            title="Open full preview in a new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View
          </a>
          <select
            value={current}
            onChange={(e) => apply(e.target.value as TemplateKey)}
            disabled={isPending}
            className="bg-zinc-100 border border-zinc-300 focus:border-zinc-500 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none disabled:opacity-50"
          >
            {TEMPLATE_OPTIONS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => apply(null)}
            disabled={isPending}
            title="Unassign template"
            className="p-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-500 hover:text-red-500 transition-colors disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

      <Layout experience={experience} subpath={subpath} />
    </div>
  );
}
