"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Search,
  Package,
  MoreVertical,
  Pencil,
  Eye,
  Archive,
  Loader2,
} from "lucide-react";
import {
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@platform/ui";
import { PRODUCT_STATUSES, type ProductStatus } from "@platform/types";
import type { ProductListItem } from "@platform/db";
import { updateProductAction } from "@/actions/product-actions";
import { ProductStatusBadge } from "./product-status-badge";
import { inputClass } from "./form-controls";

export interface ProductsQuery {
  search: string;
  category: string;
  status: string;
  page: number;
  pageSize: number;
}

export function ProductsList({
  items,
  total,
  query,
}: {
  items: ProductListItem[];
  total: number;
  query: ProductsQuery;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(query.search);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    if (query.category) set.add(query.category);
    for (const p of items) if (p.category) set.add(p.category);
    return [...set].sort();
  }, [items, query.category]);

  const navigate = (patch: Partial<ProductsQuery>) => {
    const next = { ...query, ...patch };
    const params = new URLSearchParams();
    if (next.search) params.set("search", next.search);
    if (next.category) params.set("category", next.category);
    if (next.status) params.set("status", next.status);
    // Reset to page 1 whenever a filter changes (but keep an explicit page jump).
    const page = patch.page ?? 1;
    if (page > 1) params.set("page", String(page));
    startTransition(() => router.push(`/products?${params.toString()}`));
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ search: searchInput.trim() });
  };

  const archive = (product: ProductListItem) => {
    if (product.status === "ARCHIVED") return;
    if (!window.confirm(`Archive “${product.name}”? It will stop showing on screens.`)) return;
    setArchivingId(product.id);
    startTransition(async () => {
      await updateProductAction(product.id, { status: "ARCHIVED" });
      setArchivingId(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Products</h1>
          <Badge variant="secondary">{total}</Badge>
          {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <Link href="/products/new">
          <Button>
            <Plus className="h-4 w-4" /> New product
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <form onSubmit={submitSearch} className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, SKU, category, detection label…"
            className={`${inputClass} pl-8`}
          />
        </form>
        <select
          value={query.status}
          onChange={(e) => navigate({ status: e.target.value })}
          className={`${inputClass} w-auto`}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={query.category}
          onChange={(e) => navigate({ category: e.target.value })}
          className={`${inputClass} w-auto`}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Table / states */}
      {total === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/30 p-12 text-center">
          <Package className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {query.search || query.status || query.category
              ? "No products match these filters."
              : "No products yet. Create your first one."}
          </p>
          {!(query.search || query.status || query.category) && (
            <Link href="/products/new">
              <Button size="sm">
                <Plus className="h-4 w-4" /> New product
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Detection label</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                        {p.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnailUrl} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/products/${p.id}/edit`}
                          className="block truncate font-medium hover:underline"
                        >
                          {p.name}
                        </Link>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          /{p.slug}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.sku ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.category ?? "—"}</td>
                  <td className="px-4 py-3">
                    {p.detectionLabel ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {p.detectionLabel}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ProductStatusBadge status={p.status as ProductStatus} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "2-digit",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="rounded-md p-1.5 text-muted-foreground hover:bg-accent">
                          {archivingId === p.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreVertical className="h-4 w-4" />
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/products/${p.id}/edit`}>
                            <Pencil className="h-4 w-4" /> Edit
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/products/${p.id}/edit?tab=preview`}>
                            <Eye className="h-4 w-4" /> Preview
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          disabled={p.status === "ARCHIVED"}
                          onSelect={() => archive(p)}
                        >
                          <Archive className="h-4 w-4" /> Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            Page {query.page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={query.page <= 1 || isPending}
            onClick={() => navigate({ page: query.page - 1 })}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={query.page >= totalPages || isPending}
            onClick={() => navigate({ page: query.page + 1 })}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
