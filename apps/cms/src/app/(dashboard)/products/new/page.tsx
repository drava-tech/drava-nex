import { requireAdmin } from "@/lib/auth-helpers";
import { ProductCreateForm } from "../_components/product-create-form";

export default async function NewProductPage() {
  await requireAdmin();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <ProductCreateForm />
    </div>
  );
}
