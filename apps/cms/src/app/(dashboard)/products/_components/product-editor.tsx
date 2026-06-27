"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Check } from "lucide-react";
import { Button, cn } from "@platform/ui";
import type { FieldError } from "@platform/types";
import { DEFAULT_PRODUCT_SHOWCASE_CONTENT } from "@platform/ui/templates/product-showcase";
import type { ProductDetail } from "@platform/db";
import { updateProductAction } from "@/actions/product-actions";
import {
  ProductFields,
  valuesToInput,
  detectionLabelError,
  type ProductFormValues,
} from "./product-fields";
import { FeaturesEditor } from "./features-editor";
import { SpecificationsEditor } from "./specifications-editor";
import { ProductMediaEditor } from "./product-media-editor";
import { ProductStatusBadge } from "./product-status-badge";
import { ProductShowcasePreview } from "@/templates/product-showcase/product-showcase-preview";

type Tab = "details" | "features" | "specifications" | "media" | "preview";
const TABS: { key: Tab; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "features", label: "Features" },
  { key: "specifications", label: "Specifications" },
  { key: "media", label: "Media" },
  { key: "preview", label: "Preview" },
];

function toValues(p: ProductDetail): ProductFormValues {
  return {
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? "",
    brand: p.brand ?? "",
    category: p.category ?? "",
    status: p.status,
    detectionLabel: p.detectionLabel ?? "",
    shortDescription: p.shortDescription ?? "",
    fullDescription: p.fullDescription ?? "",
  };
}

export function ProductEditor({
  product,
  initialTab = "details",
}: {
  product: ProductDetail;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [values, setValues] = useState<ProductFormValues>(toValues(product));
  const [status, setStatus] = useState(product.status);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>();
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const canSave =
    values.name.trim().length > 0 &&
    values.slug.trim().length > 0 &&
    !detectionLabelError(values.detectionLabel);

  const saveDetails = () => {
    if (!canSave || isPending) return;
    setError(null);
    setFieldErrors(undefined);
    startTransition(async () => {
      const res = await updateProductAction(product.id, valuesToInput(values));
      if (res.success) {
        setSaved(true);
        setStatus(values.status);
      } else {
        setError(res.error ?? "Failed to save.");
        setFieldErrors(res.fieldErrors);
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/products"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
            title="Back to products"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{product.name}</h1>
              <ProductStatusBadge status={status} />
            </div>
            <p className="font-mono text-xs text-muted-foreground">/{product.slug}</p>
          </div>
        </div>
        {product.detectionLabel && (
          <div className="text-xs text-muted-foreground">
            Detection label:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{product.detectionLabel}</code>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      {tab === "details" && (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border bg-card p-6">
            <ProductFields
              values={values}
              onChange={(patch) => {
                setSaved(false);
                setValues((v) => ({ ...v, ...patch }));
              }}
              disabled={isPending}
              fieldErrors={fieldErrors}
            />
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <div>
            <Button onClick={saveDetails} disabled={!canSave || isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4" />
              ) : null}
              {isPending ? "Saving…" : saved ? "Saved" : "Save changes"}
            </Button>
          </div>
        </div>
      )}

      {tab === "features" && (
        <div className="rounded-xl border bg-card p-6">
          <FeaturesEditor productId={product.id} initial={product.features} />
        </div>
      )}

      {tab === "specifications" && (
        <div className="rounded-xl border bg-card p-6">
          <SpecificationsEditor productId={product.id} initial={product.specifications} />
        </div>
      )}

      {tab === "media" && (
        <div className="rounded-xl border bg-card p-6">
          <ProductMediaEditor product={product} />
        </div>
      )}

      {tab === "preview" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Live Product Showcase preview (all sections on). Set status to ACTIVE to show it on a screen.
            </p>
            <a
              href={`/products/${product.id}/edit?tab=preview`}
              className="hidden items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground sm:flex"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Full preview
            </a>
          </div>
          <ProductShowcasePreview
            content={{ ...DEFAULT_PRODUCT_SHOWCASE_CONTENT, productId: product.id }}
            variant="fit-width"
          />
        </div>
      )}
    </div>
  );
}
