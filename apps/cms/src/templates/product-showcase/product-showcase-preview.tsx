"use client";

import { useEffect, useState } from "react";
import type { ProductDisplayData } from "@platform/types";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import {
  ProductShowcaseView,
  ProductShowcaseLoading,
  ProductShowcaseError,
  ProductShowcaseUnavailable,
  type ProductShowcaseContent,
} from "@platform/ui/templates/product-showcase";
import { getProductDisplayAction } from "@/actions/product-actions";

const PLACEHOLDER_PRODUCT: ProductDisplayData = {
  id: "placeholder-1",
  name: "AirMax Pro Headset",
  slug: "airmax-pro",
  sku: "AMX-PRO-01",
  detectionLabel: "headset_black",
  category: "Audio",
  brand: "TechCorp",
  shortDescription: "Experience immersive audio with active noise cancellation.",
  fullDescription: "The AirMax Pro delivers unparalleled sound quality with 40mm drivers and up to 30 hours of battery life. Perfect for travel, work, and everything in between.",
  status: "ACTIVE",
  thumbnail: null,
  hero: null,
  video: null,
  gallery: [
    { id: "var1", type: "image", url: "https://placehold.co/400x400/f4f2ea/a09d93?text=Variant+1", altText: "Variant 1" },
    { id: "var2", type: "image", url: "https://placehold.co/400x400/f4f2ea/a09d93?text=Variant+2", altText: "Variant 2" },
    { id: "var3", type: "image", url: "https://placehold.co/400x400/f4f2ea/a09d93?text=Variant+3", altText: "Variant 3" },
    { id: "var4", type: "image", url: "https://placehold.co/400x400/f4f2ea/a09d93?text=Variant+4", altText: "Variant 4" },
  ],
  features: [
    { id: "f1", title: "Noise Cancellation", description: "Active (ANC)", sortOrder: 0 },
    { id: "f2", title: "Battery Life", description: "30 Hours", sortOrder: 1 },
    { id: "f3", title: "Bluetooth", description: "5.3", sortOrder: 2 }
  ],
  specificationGroups: []
};

/**
 * Live preview of the Product Showcase. Fetches the product's display payload via
 * the API (server action → Hono) and renders the exact same presentational view
 * the screen uses, so the CMS preview matches the TV. No product content is
 * embedded — it always reflects the latest ACTIVE product.
 */
export function ProductShowcasePreview({
  content,
  variant = "fit-width",
  refreshKey,
}: {
  content: ProductShowcaseContent;
  variant?: "fit-width" | "fit-screen";
  /** Change to force a re-fetch (e.g. after editing the product elsewhere). */
  refreshKey?: number;
}) {
  const productId = content.productId;
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "view"; product: ProductDisplayData }
    | { kind: "unavailable"; name?: string }
    | { kind: "error"; message?: string }
    | { kind: "empty" }
  >({ kind: productId ? "loading" : "empty" });

  useEffect(() => {
    if (!productId) {
      setState({ kind: "empty" });
      return;
    }
    let active = true;
    setState({ kind: "loading" });
    getProductDisplayAction(productId).then((res) => {
      if (!active) return;
      if (res.success && res.data) {
        setState({ kind: "view", product: res.data });
      } else if (res.code === "PRODUCT_INACTIVE") {
        setState({ kind: "unavailable" });
      } else {
        setState({ kind: "error", message: res.error });
      }
    });
    return () => {
      active = false;
    };
  }, [productId, refreshKey]);

  let inner: React.ReactNode;
  switch (state.kind) {
    case "loading":
      inner = <ProductShowcaseLoading />;
      break;
    case "view":
      inner = <ProductShowcaseView product={state.product} config={content} />;
      break;
    case "unavailable":
      inner = <ProductShowcaseUnavailable name={state.name} />;
      break;
    case "error":
      inner = <ProductShowcaseError message={state.message} />;
      break;
    case "empty":
      inner = <ProductShowcaseView product={PLACEHOLDER_PRODUCT} config={content} />;
      break;
  }

  return (
    <ScreenStage variant={variant}>
      <div style={{ width: 1920, height: 1080 }}>{inner}</div>
    </ScreenStage>
  );
}
