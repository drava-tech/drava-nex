import { requireAdmin } from "@/lib/auth-helpers";
import { listDesigns } from "@/actions/design-actions";
import { TemplatesGallery } from "./_components/templates-gallery";

/**
 * Templates — Canva-style designs (landscape or portrait) that push to screens
 * like any experience. Each design is an experience on the "canvas" template;
 * the editor itself is full-tab at /edit/experiences/<slug>.
 */
export default async function TemplatesPage() {
  await requireAdmin();
  const designs = await listDesigns();
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-100 p-4 dark:bg-transparent">
      <TemplatesGallery designs={designs} />
    </div>
  );
}
