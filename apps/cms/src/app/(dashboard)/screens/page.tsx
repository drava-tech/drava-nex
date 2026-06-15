import { requireGuestOrAdmin, getCurrentUser } from "@/lib/auth-helpers";

export default async function ScreensPage() {
  await requireGuestOrAdmin();
  const currentUser = await getCurrentUser();
  const role = (currentUser as { role?: string } | null)?.role;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Screens</h1>
        <p className="text-sm text-muted-foreground">
          {role === "ADMIN"
            ? "Manage all display screens."
            : "Screens assigned to you."}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Screen management will be available once screens are configured.
      </p>
    </div>
  );
}
