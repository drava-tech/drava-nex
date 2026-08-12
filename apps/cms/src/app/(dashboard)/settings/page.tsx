import { requireAdmin } from "@/lib/auth-helpers";
import { getExperienceTypes } from "@/actions/experience-type-actions";
import { ExperienceTypesClient } from "./_components/experience-types-client";

export default async function SettingsPage() {
  await requireAdmin();

  const types = await getExperienceTypes();

  return (
    <div className="flex flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage workspace configuration.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Experience Types</h2>
          <p className="text-sm text-muted-foreground">
            Create the types people can assign when building a new experience.
          </p>
        </div>
        <ExperienceTypesClient types={types} />
      </section>
    </div>
  );
}
