"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@platform/ui";
import {
  createExperienceType,
  deleteExperienceType,
} from "@/actions/experience-type-actions";

interface ExperienceTypeRow {
  id: string;
  name: string;
}

interface Props {
  types: ExperienceTypeRow[];
}

export function ExperienceTypesClient({ types }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createExperienceType(name);
      if (res.success) {
        setName("");
        router.refresh();
      } else {
        setError(res.error ?? "Failed to create type.");
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this type? It will be removed from all experiences.")) return;
    startTransition(async () => {
      const res = await deleteExperienceType(id);
      if (res.success) {
        router.refresh();
      } else {
        alert(res.error ?? "Failed to delete type.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <form onSubmit={handleCreate} className="flex items-start gap-2">
        <div className="flex flex-col gap-1">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Retail, Lobby, Wayfinding"
            required
            className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
          {isPending ? "Adding…" : "Add Type"}
        </Button>
      </form>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-sidebar text-left text-xs text-sidebar-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  No experience types yet. Add one above.
                </td>
              </tr>
            ) : (
              types.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(t.id)}
                      disabled={isPending}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
