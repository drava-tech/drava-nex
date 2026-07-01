"use client";

import React, { useState, useTransition } from "react";
import { Button, Badge } from "@platform/ui";
import { createUser, deleteUser } from "@/actions/user-actions";
import type { User } from "@platform/db";

interface Props {
  users: User[];
}

export function UsersClient({ users }: Props) {
  const [isPending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "GUEST" as "ADMIN" | "GUEST",
  });
  const [error, setError] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createUser(form.name, form.email, form.password, form.role);
        setShowCreate(false);
        setForm({ name: "", email: "", password: "", role: "GUEST" });
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function handleDelete(userId: string) {
    if (!confirm("Delete this user?")) return;
    startTransition(async () => {
      await deleteUser(userId);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          {showCreate ? "Cancel" : "Add User"}
        </Button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-lg border p-4 max-w-md"
        >
          <h2 className="text-base font-semibold">New User</h2>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {(["name", "email", "password"] as const).map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-sm font-medium capitalize">{field}</label>
              <input
                type={field === "password" ? "password" : field === "email" ? "email" : "text"}
                required
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Role</label>
            <select
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({ ...f, role: e.target.value as "ADMIN" | "GUEST" }))
              }
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="GUEST">GUEST</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <Button type="submit" disabled={isPending} size="sm">
            {isPending ? "Creating…" : "Create User"}
          </Button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge
                    variant={
                      u.role === "ADMIN" || u.role === "SUPERADMIN"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {u.role}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {u.role === "SUPERADMIN" ? (
                    <span className="text-xs text-muted-foreground">Protected</span>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(u.id)}
                      disabled={isPending}
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
