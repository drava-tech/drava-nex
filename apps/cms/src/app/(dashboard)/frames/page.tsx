import { requireAdmin } from "@/lib/auth-helpers";
import { listDesigns } from "@/actions/design-actions";
import { FramesGallery } from "./_components/frames-gallery";

/**
 * Frames — Canva-style designs (landscape or portrait) that push to screens
 * like any experience. Each design is an experience on the "canvas" template;
 * the editor itself is full-tab at /edit/experiences/<slug>.
 */
export default async function FramesPage() {
  await requireAdmin();
  const designs = await listDesigns();
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-100 p-4 dark:bg-transparent">
      <FramesGallery designs={designs} />
    </div>
  );
}
