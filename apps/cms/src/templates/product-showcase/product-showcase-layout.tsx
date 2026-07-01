"use client";

import type { Experience } from "@platform/db";
import {
  readProductShowcaseContent,
  DEFAULT_PRODUCT_SHOWCASE_CONTENT,
} from "@platform/ui/templates/product-showcase";
import { ProductShowcasePreview } from "./product-showcase-preview";

/**
 * Product Showcase template surface for the CMS edit/preview routes. The full
 * editor (product picker + section toggles) is the Workspace; this Layout just
 * renders the live preview, scaled to fit for the preview tab.
 */
export function ProductShowcaseLayout({
  experience,
  mode = "edit",
}: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  const content =
    readProductShowcaseContent(experience.templateContent) ?? DEFAULT_PRODUCT_SHOWCASE_CONTENT;

  if (mode === "preview") {
    return <ProductShowcasePreview content={content} variant="fit-screen" />;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-violet-500">
        Product Showcase
      </span>
      <ProductShowcasePreview content={content} variant="fit-width" />
    </div>
  );
}
