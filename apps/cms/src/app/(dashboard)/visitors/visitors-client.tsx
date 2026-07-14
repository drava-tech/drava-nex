"use client";

import React, { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Badge } from "@platform/ui";
import { updateVisitor } from "@/actions/visitor-actions";
import type { VisitorListItem } from "@platform/types";

interface Props {
  visitors: VisitorListItem[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
}

function formatSeen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VisitorsClient({ visitors, total, page, pageSize, search }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(search);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "" });
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function navigate(nextPage: number, nextSearch: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextSearch) params.set("search", nextSearch);
    else params.delete("search");
    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");
    const qs = params.toString();
    router.push(qs ? `/visitors?${qs}` : "/visitors");
  }

  function startEdit(v: VisitorListItem) {
    setEditing(v.uuid);
    setForm({ name: v.name, email: v.email });
    setError(null);
  }

  function handleSave(uuid: string) {
    setError(null);
    startTransition(async () => {
      try {
        await updateVisitor(uuid, form);
        setEditing(null);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(1, searchInput.trim());
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          placeholder="Search name or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" size="sm" variant="secondary">
          Search
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">
          {total} visitor{total === 1 ? "" : "s"}
        </span>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Photo</th>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">First seen</th>
              <th className="px-4 py-3 text-left font-medium">Last seen</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visitors.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No visitors yet.
                </td>
              </tr>
            )}
            {visitors.map((v) => (
              <tr key={v.uuid} className="border-b last:border-0">
                <td className="px-4 py-2">
                  {v.hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/visitors/${v.uuid}/image`}
                      alt={v.name || "Unknown visitor"}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
                      title="Photo purged"
                    >
                      —
                    </div>
                  )}
                </td>
                {editing === v.uuid ? (
                  <>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={form.name}
                        placeholder="Name"
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="email"
                        value={form.email}
                        placeholder="Email"
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                      />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 font-medium">
                      {v.name || <span className="text-muted-foreground italic">Unknown</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{v.email || "—"}</td>
                  </>
                )}
                <td className="px-4 py-3">
                  <Badge variant="secondary">{v.role}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatSeen(v.firstSeen)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatSeen(v.lastSeen)}</td>
                <td className="px-4 py-3">
                  {editing === v.uuid ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleSave(v.uuid)} disabled={isPending}>
                        {isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(null)}
                        disabled={isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => startEdit(v)}>
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => navigate(page - 1, search)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => navigate(page + 1, search)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
