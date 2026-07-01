"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, Loader2, Check, X, Pencil } from "lucide-react";
import { Button } from "@platform/ui";
import type { ProductFeature } from "@platform/db";
import {
  addFeatureAction,
  updateFeatureAction,
  deleteFeatureAction,
} from "@/actions/product-actions";
import { Field, TextInput, TextArea } from "./form-controls";

type Feature = Pick<ProductFeature, "id" | "title" | "description" | "sortOrder">;

export function FeaturesEditor({
  productId,
  initial,
}: {
  productId: string;
  initial: Feature[];
}) {
  const [features, setFeatures] = useState<Feature[]>(
    [...initial].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const add = () => {
    const t = title.trim();
    if (!t || isPending) return;
    setError(null);
    startTransition(async () => {
      const res = await addFeatureAction(productId, {
        title: t,
        description: description.trim() || undefined,
        sortOrder: features.length,
      });
      if (res.success && res.data) {
        setFeatures((f) => [...f, res.data as Feature]);
        setTitle("");
        setDescription("");
      } else {
        setError(res.error ?? "Failed to add feature.");
      }
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("Remove this feature?")) return;
    setBusyId(id);
    startTransition(async () => {
      const res = await deleteFeatureAction(productId, id);
      if (res.success) setFeatures((f) => f.filter((x) => x.id !== id));
      else setError(res.error ?? "Failed to remove feature.");
      setBusyId(null);
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= features.length) return;
    const reordered = [...features];
    const a = reordered[index]!;
    const b = reordered[target]!;
    reordered[index] = b;
    reordered[target] = a;
    setFeatures(reordered);
    startTransition(async () => {
      await Promise.all([
        updateFeatureAction(productId, a.id, { sortOrder: target }),
        updateFeatureAction(productId, b.id, { sortOrder: index }),
      ]);
    });
  };

  const saveEdit = (id: string, next: { title: string; description: string }) => {
    const t = next.title.trim();
    if (!t) return;
    setBusyId(id);
    startTransition(async () => {
      const res = await updateFeatureAction(productId, id, {
        title: t,
        description: next.description.trim() || undefined,
      });
      if (res.success) {
        setFeatures((f) =>
          f.map((x) =>
            x.id === id ? { ...x, title: t, description: next.description.trim() || null } : x
          )
        );
        setEditingId(null);
      } else {
        setError(res.error ?? "Failed to save feature.");
      }
      setBusyId(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {features.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No features yet. Add the product&apos;s key highlights below.
          </p>
        ) : (
          features.map((f, i) =>
            editingId === f.id ? (
              <FeatureEditRow
                key={f.id}
                feature={f}
                busy={busyId === f.id}
                onCancel={() => setEditingId(null)}
                onSave={(next) => saveEdit(f.id, next)}
              />
            ) : (
              <div
                key={f.id}
                className="flex items-start gap-3 rounded-lg border bg-card p-3"
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || isPending}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === features.length - 1 || isPending}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{f.title}</p>
                  {f.description && (
                    <p className="text-sm text-muted-foreground">{f.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(f.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  disabled={busyId === f.id}
                  className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                  title="Remove"
                >
                  {busyId === f.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            )
          )
        )}
      </div>

      {/* Add row */}
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
        <Field label="New feature title">
          <TextInput
            value={title}
            placeholder="Live video streaming"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Description (optional)">
          <TextArea
            value={description}
            placeholder="Streams live video through WebSocket."
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div>
          <Button type="button" size="sm" onClick={add} disabled={!title.trim() || isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add feature
          </Button>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

function FeatureEditRow({
  feature,
  busy,
  onSave,
  onCancel,
}: {
  feature: Feature;
  busy: boolean;
  onSave: (next: { title: string; description: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(feature.title);
  const [description, setDescription] = useState(feature.description ?? "");
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onSave({ title, description })}
          disabled={!title.trim() || busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>
    </div>
  );
}
