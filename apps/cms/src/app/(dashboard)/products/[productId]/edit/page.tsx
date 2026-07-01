import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth-helpers";
import { fetchProduct } from "@/lib/products-api";
import { ProductEditor } from "../../_components/product-editor";

type Tab = "details" | "features" | "specifications" | "media" | "preview";
const VALID_TABS: Tab[] = ["details", "features", "specifications", "media", "preview"];

interface EditProductPageProps {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function EditProductPage({ params, searchParams }: EditProductPageProps) {
  await requireAdmin();
  const { productId } = await params;
  const { tab } = await searchParams;

  const res = await fetchProduct(productId);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <div className="p-6">
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Couldn&apos;t load product: {res.error.message}
        </p>
      </div>
    );
  }

  const initialTab = VALID_TABS.includes(tab as Tab) ? (tab as Tab) : "details";

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <ProductEditor product={res.data} initialTab={initialTab} />
    </div>
  );
}
