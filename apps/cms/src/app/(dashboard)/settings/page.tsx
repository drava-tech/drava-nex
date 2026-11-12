import { requireAdmin } from "@/lib/auth-helpers";

// Empty for now. Users were managed here (removed); Portfolio Types before that
// (./_components/experience-types-client, kept but unused).

export default async function SettingsPage() {
  await requireAdmin();

  return (
    <div className="flex flex-col gap-10 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage workspace configuration.</p>
      </div>
    </div>
  );
}
