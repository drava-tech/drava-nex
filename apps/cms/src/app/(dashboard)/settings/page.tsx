import { requireAdmin } from "@/lib/auth-helpers";
import { getUsers } from "@/actions/user-actions";
import { UsersSection } from "./_components/users-section";

// Portfolio Types used to be managed here too (./_components/experience-types-client).
// Taken off Settings; the types already made still tag the portfolio.

export default async function SettingsPage() {
  const user = await requireAdmin();
  const isSuperAdmin = user.role === "SUPERADMIN";

  const users = isSuperAdmin ? await getUsers() : null;

  return (
    <div className="flex flex-col gap-10 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage workspace configuration.</p>
      </div>

      {/* Only the super admin decides who can sign in. */}
      {users ? (
        <section id="users" className="flex scroll-mt-6 flex-col gap-4">
          <div>
            <h2 className="text-lg">Users</h2>
            <p className="text-sm text-muted-foreground">
              Add the people who use Nex, and choose what they can do.
            </p>
          </div>
          <UsersSection users={users} currentUserId={user.id} />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">There&apos;s nothing to set up here for your account.</p>
      )}
    </div>
  );
}
