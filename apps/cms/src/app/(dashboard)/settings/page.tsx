import { requireAdmin } from "@/lib/auth-helpers";
import { getExperienceTypes } from "@/actions/experience-type-actions";
import { getUsers } from "@/actions/user-actions";
import { ExperienceTypesClient } from "./_components/experience-types-client";
import { UsersSection } from "./_components/users-section";

export default async function SettingsPage() {
  const user = await requireAdmin();
  const isSuperAdmin = user.role === "SUPERADMIN";

  const [types, users] = await Promise.all([getExperienceTypes(), isSuperAdmin ? getUsers() : Promise.resolve(null)]);

  return (
    <div className="flex flex-col gap-10 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage workspace configuration.</p>
      </div>

      {/* Only the super admin decides who can sign in. */}
      {users && (
        <section id="users" className="flex scroll-mt-6 flex-col gap-4">
          <div>
            <h2 className="text-lg">Users</h2>
            <p className="text-sm text-muted-foreground">
              Add the people who use Nex, and choose what they can do.
            </p>
          </div>
          <UsersSection users={users} currentUserId={user.id} />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg">Experience Types</h2>
          <p className="text-sm text-muted-foreground">
            Create the types people can assign when building a new experience.
          </p>
        </div>
        <ExperienceTypesClient types={types} />
      </section>
    </div>
  );
}
