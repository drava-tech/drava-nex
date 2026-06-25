"use client";

import React, { useState, useTransition } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@platform/ui";
import { createProject } from "@/actions/project-actions";
import { TEMPLATE_KEYS, TEMPLATE_LABELS } from "@/lib/templates";

interface CreateProjectModalProps {
  onClose: () => void;
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

export function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      const result = await createProject(name, slug, templateKey || null);
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
            <h2 className="text-lg font-semibold tracking-tight">Create Experience</h2>
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
              "Create Experience"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
