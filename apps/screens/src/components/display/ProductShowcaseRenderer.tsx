"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductDisplayData } from "@platform/types";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import {
  ProductShowcaseView,
  ProductShowcaseLoading,
  ProductShowcaseError,
  ProductShowcaseUnavailable,
  readProductShowcaseContent,
  DEFAULT_PRODUCT_SHOWCASE_CONTENT,
} from "@platform/ui/templates/product-showcase";
import { resolveBrowserApiEndpoint } from "@/lib/client-urls";
import type { ExperienceContent } from "@/types/display";

/**
 * Renders a Product Showcase experience on a screen. Reads the productId from the
 * experience config and fetches the product's display payload from the API at
 * render time (never embedding product content). Caches the last successful
 * product by id so a re-pushed identical experience doesn't refetch.
 */
export function ProductShowcaseRenderer({ content }: { content: ExperienceContent }) {
  const config =
    readProductShowcaseContent(content.templateContent) ?? DEFAULT_PRODUCT_SHOWCASE_CONTENT;
  const productId = config.productId;

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "view"; product: ProductDisplayData }
    | { kind: "unavailable" }
    | { kind: "error"; message?: string }
    | { kind: "empty" }
  >({ kind: productId ? "loading" : "empty" });

  // Cache the last product we successfully rendered, keyed by id.
  const cache = useRef<{ id: string; product: ProductDisplayData } | null>(null);

  useEffect(() => {
    if (!productId) {
      setState({ kind: "empty" });
      return;
    }
    if (cache.current?.id === productId) {
      setState({ kind: "view", product: cache.current.product });
      return;
    }

    let active = true;
    setState({ kind: "loading" });

    const apiBase = process.env["NEXT_PUBLIC_API_URL"] ?? "";
    const url = resolveBrowserApiEndpoint(
      apiBase,
      `/api/products/${encodeURIComponent(productId)}/display`
    );

    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { success: boolean; data?: ProductDisplayData; error?: { code?: string } }
          | null;
        if (!active) return;
        if (res.ok && body?.data) {
          cache.current = { id: productId, product: body.data };
          setState({ kind: "view", product: body.data });
        } else if (body?.error?.code === "PRODUCT_INACTIVE") {
          setState({ kind: "unavailable" });
        } else {
          setState({ kind: "error", message: "Product unavailable." });
        }
      })
      .catch(() => {
        if (active) setState({ kind: "error" });
      });

    return () => {
      active = false;
    };
  }, [productId]);

  let inner: React.ReactNode;
  switch (state.kind) {
    case "loading":
      inner = <ProductShowcaseLoading />;
      break;
    case "view":
      inner = <ProductShowcaseView product={state.product} config={config} />;
      break;
    case "unavailable":
      inner = <ProductShowcaseUnavailable />;
      break;
    case "error":
      inner = <ProductShowcaseError message={state.message} />;
      break;
    case "empty":
      inner = <ProductShowcaseError message="No product assigned to this experience." />;
      break;
  }

  return (
    <ScreenStage variant="fit-screen">
      <div style={{ width: 1920, height: 1080 }}>{inner}</div>
    </ScreenStage>
  );
}
