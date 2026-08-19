"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Check, Search, Package } from "lucide-react";
import type { Experience } from "@platform/db";
import type { ProductListItem } from "@platform/db";
import { updateExperienceTemplateContent } from "@/actions/experience-actions";
import { listProductsForPickerAction } from "@/actions/product-actions";
import { CameraSelector } from "@/components/camera-selector";
import {
  DEFAULT_PRODUCT_SHOWCASE_CONTENT,
  type ProductShowcaseContent,
} from "@platform/ui/templates/product-showcase";
import { ProductShowcasePreview } from "./product-showcase-preview";

const SECTION_TOGGLES: { key: keyof ProductShowcaseContent; label: string }[] = [
  { key: "showHero", label: "Hero image / video" },
  { key: "showVideo", label: "Demo video in hero" },
  { key: "showFeatures", label: "Features" },
  { key: "showSpecifications", label: "Specifications" },
  { key: "showGallery", label: "Gallery" },
];

/**
 * Full-tab editor for the Product Showcase template: pick a CMS product and choose
 * which sections appear, with a live preview that fetches the product exactly like
 * the screen does. Only the productId + toggles are stored on the experience.
 */
export function ProductShowcaseEditorWorkspace({
  experience,
  initialContent,
}: {
  experience: Experience;
  initialContent: ProductShowcaseContent;
}) {
  const router = useRouter();
  const [content, setContent] = useState<ProductShowcaseContent>({
    ...DEFAULT_PRODUCT_SHOWCASE_CONTENT,
    ...initialContent,
  });
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingProducts(true);
    listProductsForPickerAction().then((res) => {
      if (!active) return;
      if (res.success && res.data) setProducts(res.data.items);
      else setError(res.error ?? "Failed to load products.");
      setLoadingProducts(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.sku ?? "").toLowerCase().includes(term) ||
        (p.detectionLabel ?? "").toLowerCase().includes(term)
    );
  }, [products, search]);

  const selectedProduct = products.find((p) => p.id === content.productId) ?? null;

  const update = (patch: Partial<ProductShowcaseContent>) => {
    setSaved(false);
    setContent((c) => ({ ...c, ...patch }));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateExperienceTemplateContent(
        experience.id,
        "product-showcase",
        content
      );
      if (res.success) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Failed to save.");
      }
    });
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#432992] bg-white px-4 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/experiences"
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Back to experiences"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {experience.name}
            </p>
            <p className="text-[11px] text-zinc-400">Product Showcase</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/preview/experiences/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View
          </a>
          <button
            onClick={save}
            disabled={isPending}
            className="flex min-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saved ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {isPending ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[400px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-[#432992] bg-white p-4 dark:bg-zinc-900">
          {/* Product picker */}
          <div className="flex flex-col gap-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              Product
            </h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="w-full rounded-md border border-[#432992] bg-zinc-100 py-2 pl-8 pr-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>

            <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
              {loadingProducts ? (
                <div className="flex items-center gap-2 px-1 py-6 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : filtered.length === 0 ? (
                <p className="px-1 py-6 text-sm text-zinc-400">
                  No products. Create one in the Products section first.
                </p>
              ) : (
                filtered.map((p) => {
                  const active = p.id === content.productId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => update({ productId: p.id })}
                      className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                        active
                          ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10"
                          : "border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-200 dark:bg-zinc-800">
                        {p.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnailUrl} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-4 w-4 text-zinc-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {p.name}
                        </p>
                        <p className="truncate text-[11px] text-zinc-400">
                          {p.status}
                          {p.sku ? ` · ${p.sku}` : ""}
                        </p>
                      </div>
                      {active && <Check className="h-4 w-4 shrink-0 text-violet-500" />}
                    </button>
                  );
                })
              )}
            </div>
            {selectedProduct && selectedProduct.status !== "ACTIVE" && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                This product is {selectedProduct.status}. The screen shows it only when ACTIVE.
              </p>
            )}
          </div>

          {/* Detection camera — only this template needs one */}
          <div className="flex flex-col gap-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              Detection Camera
            </h2>
            <CameraSelector
              value={content.cameraId}
              onChange={(cameraId) => update({ cameraId })}
            />
          </div>

          {/* Section toggles */}
          <div className="flex flex-col gap-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              Sections
            </h2>
            <div className="flex flex-col gap-1">
              {SECTION_TOGGLES.map((t) => (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {t.label}
                  <input
                    type="checkbox"
                    checked={Boolean(content[t.key])}
                    onChange={(e) => update({ [t.key]: e.target.checked })}
                    className="h-4 w-4 accent-violet-600"
                  />
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </aside>

        <main className="min-w-0 flex-1 bg-zinc-200 p-6 dark:bg-zinc-900/40">
          <ProductShowcasePreview content={content} variant="fit-width" />
        </main>
      </div>
    </div>
  );
}
