"use client";

import { useState, useTransition, useMemo } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, Loader2, Check, X, Pencil } from "lucide-react";
import { Button } from "@platform/ui";
import type { ProductSpecification } from "@platform/db";
import {
  addSpecificationAction,
  updateSpecificationAction,
  deleteSpecificationAction,
} from "@/actions/product-actions";
import { Field, TextInput } from "./form-controls";

type Spec = Pick<
  ProductSpecification,
  "id" | "groupName" | "label" | "value" | "unit" | "sortOrder"
>;

interface NewSpec {
  groupName: string;
  label: string;
  value: string;
  unit: string;
}

export function SpecificationsEditor({
  productId,
  initial,
}: {
  productId: string;
  initial: Spec[];
}) {
  const [specs, setSpecs] = useState<Spec[]>(
    [...initial].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [draft, setDraft] = useState<NewSpec>({ groupName: "", label: "", value: "", unit: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const groups = useMemo(() => [...new Set(specs.map((s) => s.groupName))], [specs]);

  const add = () => {
    const groupName = draft.groupName.trim();
    const label = draft.label.trim();
    const value = draft.value.trim();
    if (!groupName || !label || !value || isPending) return;
    setError(null);
    startTransition(async () => {
      const res = await addSpecificationAction(productId, {
        groupName,
        label,
        value,
        unit: draft.unit.trim() || undefined,
        sortOrder: specs.length,
      });
      if (res.success && res.data) {
        setSpecs((s) => [...s, res.data as Spec]);
        setDraft({ groupName, label: "", value: "", unit: "" });
      } else {
        setError(res.error ?? "Failed to add specification.");
      }
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("Remove this specification?")) return;
    setBusyId(id);
    startTransition(async () => {
      const res = await deleteSpecificationAction(productId, id);
      if (res.success) setSpecs((s) => s.filter((x) => x.id !== id));
      else setError(res.error ?? "Failed to remove specification.");
      setBusyId(null);
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= specs.length) return;
    const reordered = [...specs];
    const a = reordered[index]!;
    const b = reordered[target]!;
    reordered[index] = b;
    reordered[target] = a;
    setSpecs(reordered);
    startTransition(async () => {
      await Promise.all([
        updateSpecificationAction(productId, a.id, { sortOrder: target }),
        updateSpecificationAction(productId, b.id, { sortOrder: index }),
      ]);
    });
  };

  const saveEdit = (id: string, next: Spec) => {
    if (!next.groupName.trim() || !next.label.trim() || !next.value.trim()) return;
    setBusyId(id);
    startTransition(async () => {
      const res = await updateSpecificationAction(productId, id, {
        groupName: next.groupName.trim(),
        label: next.label.trim(),
        value: next.value.trim(),
        unit: next.unit?.trim() || undefined,
      });
      if (res.success) {
        setSpecs((s) => s.map((x) => (x.id === id ? { ...next, unit: next.unit?.trim() || null } : x)));
        setEditingId(null);
      } else {
        setError(res.error ?? "Failed to save specification.");
      }
      setBusyId(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {specs.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No specifications yet. Group related specs (e.g. “Connectivity”).
          </p>
        ) : (
          specs.map((s, i) =>
            editingId === s.id ? (
              <SpecEditRow
                key={s.id}
                spec={s}
                groups={groups}
                busy={busyId === s.id}
                onCancel={() => setEditingId(null)}
                onSave={(next) => saveEdit(s.id, next)}
              />
            ) : (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
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
                    disabled={i === specs.length - 1 || isPending}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <span className="w-32 shrink-0 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.groupName}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="min-w-0 flex-1 truncate text-right font-medium">
                  {s.value}
                  {s.unit ? <span className="ml-1 text-muted-foreground">{s.unit}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingId(s.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  disabled={busyId === s.id}
                  className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                  title="Remove"
                >
                  {busyId === s.id ? (
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
        <datalist id="spec-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Group">
            <TextInput
              list="spec-groups"
              value={draft.groupName}
              placeholder="Connectivity"
              onChange={(e) => setDraft((d) => ({ ...d, groupName: e.target.value }))}
            />
          </Field>
          <Field label="Label">
            <TextInput
              value={draft.label}
              placeholder="Network"
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
          </Field>
          <Field label="Value">
            <TextInput
              value={draft.value}
              placeholder="Wi-Fi"
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
            />
          </Field>
          <Field label="Unit (optional)">
            <TextInput
              value={draft.unit}
              placeholder="GHz"
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
            />
          </Field>
        </div>
        <div>
          <Button
            type="button"
            size="sm"
            onClick={add}
            disabled={!draft.groupName.trim() || !draft.label.trim() || !draft.value.trim() || isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add specification
          </Button>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

function SpecEditRow({
  spec,
  groups,
  busy,
  onSave,
  onCancel,
}: {
  spec: Spec;
  groups: string[];
  busy: boolean;
  onSave: (next: Spec) => void;
  onCancel: () => void;
}) {
  const [groupName, setGroupName] = useState(spec.groupName);
  const [label, setLabel] = useState(spec.label);
  const [value, setValue] = useState(spec.value);
  const [unit, setUnit] = useState(spec.unit ?? "");
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextInput list="spec-groups" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group" />
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        <TextInput value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" />
        <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit (optional)" />
      </div>
      <datalist id="spec-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onSave({ ...spec, groupName, label, value, unit })}
          disabled={!groupName.trim() || !label.trim() || !value.trim() || busy}
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
