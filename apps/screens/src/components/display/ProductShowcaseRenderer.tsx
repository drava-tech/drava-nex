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
  const isDetectionTrigger = content.id.startsWith("detection-");

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
      inner = <WaitingForTrigger content={content} />;
      break;
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <ScreenStage variant="fit-screen">
        <div style={{ width: 1920, height: 1080 }}>{inner}</div>
      </ScreenStage>
      {state.kind === "view" && isDetectionTrigger ? (
        <TriggeredProductBadge product={state.product} />
      ) : null}
    </div>
  );
}

function WaitingForTrigger({ content }: { content: ExperienceContent }) {
  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        backgroundColor: "#09090b",
        padding: 96,
        textAlign: "center",
        color: "#d4d4d8",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p style={{ margin: 0, fontSize: 46, fontWeight: 700, color: "#fff" }}>
        Waiting for product trigger
      </p>
      <p style={{ margin: 0, maxWidth: 1100, fontSize: 26, lineHeight: 1.35, color: "#a1a1aa" }}>
        This screen is running the {content.title ?? "product showcase"} layout, but no product is
        saved on the experience. When the camera detects a known product, the detected product will
        appear here automatically.
      </p>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "12px 20px",
          maxWidth: 920,
          textAlign: "left",
          fontSize: 20,
        }}
      >
        <dt style={{ color: "#71717a", fontWeight: 700 }}>Experience</dt>
        <dd style={{ margin: 0 }}>{content.title ?? content.id}</dd>
        <dt style={{ color: "#71717a", fontWeight: 700 }}>Template</dt>
        <dd style={{ margin: 0 }}>{content.templateKey ?? "unknown"}</dd>
        <dt style={{ color: "#71717a", fontWeight: 700 }}>Product ID</dt>
        <dd style={{ margin: 0 }}>none assigned</dd>
      </dl>
    </div>
  );
}

function TriggeredProductBadge({ product }: { product: ProductDisplayData }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 24,
        left: 24,
        zIndex: 30,
        display: "flex",
        maxWidth: "min(760px, calc(100vw - 48px))",
        flexDirection: "column",
        gap: 8,
        border: "1px solid rgba(74, 222, 128, 0.35)",
        borderRadius: 12,
        backgroundColor: "rgba(0, 0, 0, 0.72)",
        padding: "14px 18px",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          color: "#4ade80",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
        }}
      >
        Triggered product
      </span>
      <strong style={{ fontSize: 28, lineHeight: 1.1 }}>{product.name}</strong>
      <span style={{ fontSize: 15, color: "#d4d4d8" }}>
        label: {product.detectionLabel ?? "none"} | id: {product.id}
      </span>
    </div>
  );
}
