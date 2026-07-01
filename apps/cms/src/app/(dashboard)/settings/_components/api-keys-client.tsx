"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@platform/ui";
import {
  createApiKey,
  revokeApiKey,
  type ApiKeyRow,
} from "@/actions/api-key-actions";

// Scopes a key can be granted. Mirrors the guards in apps/api (requireApiClient).
const AVAILABLE_SCOPES = [
  { value: "devices:read", label: "Read devices" },
  { value: "devices:write", label: "Control devices (lights/scenes)" },
  { value: "screens:command", label: "Send screen commands" },
  { value: "events:subscribe", label: "Subscribe to WS events (Unreal Engine)" },
  { value: "*", label: "Full access (all scopes)" },
] as const;

interface Props {
  keys: ApiKeyRow[];
}

export function ApiKeysClient({ keys }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNewKey(null);
    startTransition(async () => {
      const res = await createApiKey(name, scopes);
      if (res.success && res.key) {
        setNewKey(res.key);
        setName("");
        setScopes([]);
        router.refresh();
      } else {
        setError(res.error ?? "Failed to create API key.");
      }
    });
  }

  function handleRevoke(id: string) {
    if (!confirm("Revoke this API key? Clients using it will stop working immediately.")) return;
    startTransition(async () => {
      const res = await revokeApiKey(id);
      if (res.success) {
        router.refresh();
      } else {
        alert(res.error ?? "Failed to revoke key.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {newKey && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">
            Copy this key now — it will not be shown again:
          </p>
          <code className="mt-2 block break-all rounded bg-amber-100 px-2 py-1 font-mono text-amber-950">
            {newKey}
          </code>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Key name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Unreal Engine — Lobby"
            required
            className="w-72 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Scopes</label>
          <div className="flex flex-col gap-1">
            {AVAILABLE_SCOPES.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(s.value)}
                  onChange={() => toggleScope(s.value)}
                />
                <span>
                  {s.label} <code className="text-xs text-muted-foreground">{s.value}</code>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div>
          <Button type="submit" size="sm" disabled={isPending || !name.trim() || scopes.length === 0}>
            {isPending ? "Creating…" : "Create API key"}
          </Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Prefix</th>
              <th className="px-4 py-3 text-left font-medium">Scopes</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No API keys yet. Create one above for Unreal Engine or IoT clients.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{k.prefix}…</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {k.scopes.join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {k.revokedAt ? (
                      <span className="text-destructive">Revoked</span>
                    ) : (
                      <span className="text-green-600">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!k.revokedAt && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRevoke(k.id)}
                        disabled={isPending}
                      >
                        Revoke
                      </Button>
                    )}
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
