import { requireAdmin } from "@/lib/auth-helpers";
import { db } from "@platform/db";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  await requireAdmin();

  const allUsers = await db.query.user.findMany({
    orderBy: (u, { asc }) => [asc(u.createdAt)],
  });

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage user accounts and roles.
        </p>
      </div>
      <UsersClient users={allUsers} />
    </div>
  );
}
