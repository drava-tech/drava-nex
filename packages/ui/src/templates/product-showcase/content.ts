// Content shape for the Product Showcase template. Stored on the experience as
// experience.templateContent["product-showcase"]. It holds ONLY a productId and
// display toggles — never product content itself. The display fetches the live
// product data from the API at render time, so the latest ACTIVE product always
// shows. Shared by the CMS (editor + preview) and the screens app (live render).

export interface ProductShowcaseContent {
  /** The CMS product to display. The template fetches its data at render time. */
  productId: string;
  showHero: boolean;
  showFeatures: boolean;
  showSpecifications: boolean;
  showGallery: boolean;
  showVideo: boolean;
  /** Reserved: auto-advance through gallery media (not yet wired). */
  autoRotateMedia: boolean;
  layout: "DEFAULT";
}

export const DEFAULT_PRODUCT_SHOWCASE_CONTENT: ProductShowcaseContent = {
  productId: "",
  showHero: true,
  showFeatures: true,
  showSpecifications: true,
  showGallery: true,
  showVideo: true,
  autoRotateMedia: false,
  layout: "DEFAULT",
};

/** Reads the product-showcase content slice off an experience row, or null. */
export function readProductShowcaseContent(
  templateContent: Record<string, unknown> | null | undefined
): ProductShowcaseContent | null {
  const slice = templateContent?.["product-showcase"];
  if (!slice || typeof slice !== "object") return null;
  return { ...DEFAULT_PRODUCT_SHOWCASE_CONTENT, ...(slice as Partial<ProductShowcaseContent>) };
}
