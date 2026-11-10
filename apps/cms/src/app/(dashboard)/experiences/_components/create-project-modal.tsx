"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { X, Loader2, Check } from "lucide-react";
import { Button, cn } from "@platform/ui";
import { createProject } from "@/actions/project-actions";
import { TEMPLATE_KEYS, TEMPLATE_LABELS } from "@/lib/templates";

interface CreateProjectModalProps {
  onClose: () => void;
  experienceTypes?: { id: string; name: string }[];
}

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const inputClasses =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50";

const labelClasses = "text-xs font-medium text-muted-foreground";

export function CreateProjectModal({ onClose, experienceTypes = [] }: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("");
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggleType = (id: string) =>
    setSelectedTypeIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugEdited) {
      setSlug(deriveSlug(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlug(value);
    setSlugEdited(true);
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createProject(name, slug, templateKey || null, selectedTypeIds);
      if (result.success) {
        onClose();
      } else {
        setError(result.error ?? "An unexpected error occurred.");
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-md rounded-t-2xl border bg-card p-6 text-card-foreground shadow-lg md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              New experience
            </p>
            <h2 className="text-lg font-semibold tracking-tight">Add to Portfolio</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className={labelClasses}>Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My New Project"
              required
              disabled={isPending}
              className={inputClasses}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClasses}>Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="my-new-project"
              required
              disabled={isPending}
              className={`${inputClasses} font-mono`}
            />
            <p className="text-xs text-muted-foreground">
              URL: /experiences/{slug || "…"}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClasses}>Template</label>
            <select
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              disabled={isPending}
              className={inputClasses}
            >
              <option value="">None (assign later)</option>
              {TEMPLATE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {TEMPLATE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClasses}>Types</label>
            {experienceTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No types yet. Create them in{" "}
                <Link href="/settings" className="underline hover:text-foreground">
                  Settings
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {experienceTypes.map((t) => {
                  const selected = selectedTypeIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleType(t.id)}
                      disabled={isPending}
                      aria-pressed={selected}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <p className="-mt-1 text-xs font-medium text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            disabled={isPending || !name.trim() || !slug.trim()}
            className="mt-1 w-full"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Add to Portfolio"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
