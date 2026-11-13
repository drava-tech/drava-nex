import { requireAdmin } from "@/lib/auth-helpers";
import { roleLabel, ROLE_DESCRIPTIONS, type UserRole } from "@/lib/roles";
import { AppearanceSection } from "./_components/appearance-section";

// Users were managed here (removed); Portfolio Types before that
// (./_components/experience-types-client, kept but unused).

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const user = await requireAdmin();

  return (
    <div className="flex max-w-3xl flex-col gap-10 p-4 sm:p-6">
      <Section title="Appearance" description="How Nex looks on this device.">
        <AppearanceSection />
      </Section>

      <Section title="Your account" description="Who you're signed in as.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 rounded-xl border bg-card p-4 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="min-w-0 truncate">{user.name}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="min-w-0 truncate">{user.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd className="min-w-0">
            <span className="font-medium">{roleLabel(user.role)}</span>
            <span className="block text-muted-foreground">{ROLE_DESCRIPTIONS[user.role as UserRole]}</span>
          </dd>
        </dl>
      </Section>
    </div>
  );
}
