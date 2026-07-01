import { requireAdmin } from "@/lib/auth-helpers";
import { getExperienceTypes } from "@/actions/experience-type-actions";
import { getApiKeys } from "@/actions/api-key-actions";
import { ExperienceTypesClient } from "./_components/experience-types-client";
import { ApiKeysClient } from "./_components/api-keys-client";

export default async function SettingsPage() {
  await requireAdmin();

  const [types, apiKeys] = await Promise.all([getExperienceTypes(), getApiKeys()]);

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

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">API Keys</h2>
          <p className="text-sm text-muted-foreground">
            Issue scoped keys for machine clients (Unreal Engine, IoT cameras,
            automation). Send the key as the <code>x-api-key</code> header.
          </p>
        </div>
        <ApiKeysClient keys={apiKeys} />
      </section>
    </div>
  );
}
