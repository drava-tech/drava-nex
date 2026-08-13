import type { ProductStatus } from "@platform/types";
import { requireAdmin } from "@/lib/auth-helpers";
import { fetchProducts } from "@/lib/products-api";
import { ProductsList, type ProductsQuery } from "./_components/products-list";

interface ProductsPageProps {
  searchParams: Promise<{
    search?: string;
    category?: string;
    status?: string;
    page?: string;
  }>;
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  await requireAdmin();
  const sp = await searchParams;

  const pageSize = 20;
  const page = Math.max(1, Number(sp.page) || 1);
  const query: ProductsQuery = {
    search: sp.search ?? "",
    category: sp.category ?? "",
    status: sp.status ?? "",
    page,
    pageSize,
  };

  const res = await fetchProducts({
    page,
    pageSize,
    search: query.search || undefined,
    category: query.category || undefined,
    status: (query.status || undefined) as ProductStatus | undefined,
  });

  const data = res.ok ? res.data : { items: [], total: 0, page, pageSize };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {!res.ok && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Couldn&apos;t load products: {res.error.message}
        </p>
      )}
      <ProductsList items={data.items} total={data.total} query={query} />
    </div>
  );
}
