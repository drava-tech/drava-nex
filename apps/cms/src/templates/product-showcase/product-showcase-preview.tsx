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
      inner = (
        <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-[32px] text-zinc-500">
          Select a product to preview
        </div>
      );
      break;
  }

  return (
    <ScreenStage variant={variant}>
      <div style={{ width: 1920, height: 1080 }}>{inner}</div>
    </ScreenStage>
  );
}
