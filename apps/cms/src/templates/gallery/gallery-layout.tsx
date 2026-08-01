import type { Experience } from "@platform/db";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import {
  GalleryView,
  readGalleryContent,
  normalizePages,
  pageSlugs,
} from "@platform/ui/templates/gallery";

/**
 * Gallery template — a set of pages that all share one layout: a text block and
 * four photos, where tapping a photo expands it over most of the screen and
 * blurs the rest (edited via editor-workspace.tsx).
 *
 * Resolves the URL sub-path to a page:
 *   []              → the first page
 *   [<page-slug>]   → that page
 * An unknown slug degrades to the first page rather than 404ing, so a link that
 * outlived a page rename still lands somewhere sensible — same treatment the
 * portfolio layout gives its vertical/section slugs.
 *
 * Expansion itself is transient local state, so it never appears in the URL.
 */
export function GalleryLayout({
  experience,
  subpath,
}: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  const content = readGalleryContent(experience.templateContent) ?? undefined;
  const pages = normalizePages(content);

  const seg = subpath[0] ?? "";
  const found = seg ? pageSlugs(pages).indexOf(seg) : -1;
  const pageIndex = found >= 0 ? found : 0;

  return (
    <ScreenStage variant="fit-screen">
      <GalleryView content={content} pageIndex={pageIndex} />
    </ScreenStage>
  );
}
