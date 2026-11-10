"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Eye, EyeOff, KeyRound, MoreVertical, RefreshCw, Shield, Trash2, UserPlus, UserRound, X } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@platform/ui";
import type { UserListRow } from "@platform/db";
import { changeUserRole, createUser, deleteUser, resetUserPassword } from "@/actions/user-actions";
import { ROLE_DESCRIPTIONS, roleLabel, type UserRole } from "@/lib/roles";

type AssignableRole = "GUEST" | "ADMIN";

/** A readable random password: 12 characters, no look-alikes (0/O, 1/l). */
function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function lastActive(iso: string | null): string {
  if (!iso) return "Never signed in";
  const diff = Date.now() - Date.parse(iso);
  const m = Math.round(diff / 60000);
  if (m < 2) return "Active now";
  if (m < 60) return `Active ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Active ${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `Active ${d}d ago`;
  return `Last active ${new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

const ROLE_BADGE: Record<UserRole, string> = {
  SUPERADMIN: "bg-primary/15 text-primary-ink",
  ADMIN: "bg-info/15 text-info",
  GUEST: "bg-muted text-muted-foreground",
};

/**
 * Settings → Users: everyone who can sign in to Nex, for the super admin to
 * add, change the role of, reset the password of, or remove.
 */
export function UsersSection({ users, currentUserId }: { users: UserListRow[]; currentUserId: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<UserListRow | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ success: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.success) alert(res.error ?? "Something went wrong.");
      router.refresh();
    });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {adding && <AddUserDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); router.refresh(); }} />}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? "person" : "people"} can sign in.
        </p>
        <Button variant="pill" size="pill" onClick={() => setAdding(true)}>
          <UserPlus className="h-4 w-4" />
          Add user
        </Button>
      </div>

      <ul className={`divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card ${pending ? "opacity-70" : ""}`}>
        {users.map((u) => {
          const isMe = u.id === currentUserId;
          const editable = !isMe && u.role !== "SUPERADMIN";
          return (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-foreground/80">
                {initials(u.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm">
                  <span className="truncate">{u.name}</span>
                  {isMe && <span className="shrink-0 text-[11px] text-muted-foreground">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {u.email} · {lastActive(u.lastActiveAt)}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${ROLE_BADGE[u.role]}`}>{roleLabel(u.role)}</span>
              {editable ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Actions for ${u.name}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {u.role === "GUEST" ? (
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 py-1"
                        onSelect={() => {
                          if (confirm(`Make ${u.name} an admin? They'll be able to change settings, screens, media and schedules. They'll be signed out so the change applies.`)) {
                            run(() => changeUserRole(u.id, "ADMIN"));
                          }
                        }}
                      >
                        <Shield className="h-4 w-4" /> Make admin
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 py-1"
                        onSelect={() => {
                          if (confirm(`Make ${u.name} a user? They'll keep using Nex but lose admin rights. They'll be signed out so the change applies.`)) {
                            run(() => changeUserRole(u.id, "GUEST"));
                          }
                        }}
                      >
                        <UserRound className="h-4 w-4" /> Make user
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="cursor-pointer gap-2 py-1" onSelect={() => setResetting(u)}>
                      <KeyRound className="h-4 w-4" /> Reset password
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="cursor-pointer gap-2 py-1 text-destructive focus:text-destructive"
                      onSelect={() => {
                        if (confirm(`Remove ${u.name} (${u.email})? They won't be able to sign in any more.`)) {
                          run(() => deleteUser(u.id));
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="h-8 w-8 shrink-0" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        {(["GUEST", "ADMIN"] as const).map((r) => (
          <p key={r} className="rounded-xl bg-muted/50 px-3 py-2">
            <span className="text-foreground">{roleLabel(r)}:</span> {ROLE_DESCRIPTIONS[r]}
          </p>
        ))}
      </div>
    </div>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-3xl border border-border bg-popover p-6 text-popover-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-heading text-base">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";

/** A password box with show/hide, generate and copy. */
function PasswordField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          autoFocus={autoFocus}
          aria-label="Password"
          className={`${inputCls} pr-10`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            onChange(generatePassword());
            setShow(true);
          }}
          className="btn-surface flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Generate
        </button>
        <button
          type="button"
          disabled={!value}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="btn-surface flex items-center gap-1.5 rounded-full px-3 py-1 text-xs disabled:opacity-50"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function AddUserDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AssignableRole>("GUEST");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Enter their name.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("The password needs at least 8 characters.");
    setSaving(true);
    const res = await createUser({ name: name.trim(), email: email.trim(), password, role });
    setSaving(false);
    if (!res.success) return setError(res.error);
    onDone();
  };

  return (
    <Dialog title="Add user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" maxLength={80} autoFocus className={inputCls} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">Email (they sign in with this)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" className={inputCls} />
        </label>
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Password</span>
          <PasswordField value={password} onChange={setPassword} />
        </div>
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">Role</span>
          <div role="radiogroup" aria-label="Role" className="grid gap-2">
            {(["GUEST", "ADMIN"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => setRole(r)}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                  role === r ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                }`}
              >
                <span className="block text-sm">{roleLabel(r)}{r === "GUEST" && <span className="text-muted-foreground"> · recommended</span>}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Share the email and password with them yourself; Nex doesn't send emails. You can reset the password any time.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary w-full rounded-full py-3 text-sm disabled:opacity-50">
          {saving ? "Adding…" : `Add ${roleLabel(role).toLowerCase()}`}
        </button>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserListRow; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("The password needs at least 8 characters.");
    setSaving(true);
    const res = await resetUserPassword(user.id, password);
    setSaving(false);
    if (!res.success) return setError(res.error);
    setDone(true);
  };

  return (
    <Dialog title={`Reset password for ${user.name}`} onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm">The new password is set, and {user.name} has been signed out everywhere.</p>
          <p className="text-[11px] text-muted-foreground">Copy it now and share it with them; it isn't shown again.</p>
          <PasswordField value={password} onChange={() => {}} />
          <button type="button" onClick={onClose} className="btn-primary w-full rounded-full py-3 text-sm">Done</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {user.email} will be signed out on every device and needs the new password to sign back in.
          </p>
          <PasswordField value={password} onChange={setPassword} autoFocus />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full rounded-full py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Set new password"}
          </button>
        </form>
      )}
    </Dialog>
  );
}
