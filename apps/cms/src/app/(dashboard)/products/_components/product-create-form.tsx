"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@platform/ui";
import type { FieldError } from "@platform/types";
import { createProductAction } from "@/actions/product-actions";
import {
  ProductFields,
  EMPTY_PRODUCT_VALUES,
  valuesToInput,
  detectionLabelError,
  type ProductFormValues,
} from "./product-fields";

/**
 * Create a product (basic info only). Media, features and specifications are
 * added on the edit screen once the product exists, so we never block creation on
 * them. On success we go straight to the edit screen.
 */
export function ProductCreateForm() {
  const router = useRouter();
  const [values, setValues] = useState<ProductFormValues>(EMPTY_PRODUCT_VALUES);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>();
  const [isPending, startTransition] = useTransition();

  const canSubmit =
    values.name.trim().length > 0 &&
    values.slug.trim().length > 0 &&
    !detectionLabelError(values.detectionLabel);

  const onChange = (patch: Partial<ProductFormValues>) =>
    setValues((v) => ({ ...v, ...patch }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || isPending) return;
    setError(null);
    setFieldErrors(undefined);
    startTransition(async () => {
      const res = await createProductAction(valuesToInput(values));
      if (res.success && res.data) {
        router.push(`/products/${res.data.id}/edit`);
      } else {
        setError(res.error ?? "Failed to create product.");
        setFieldErrors(res.fieldErrors);
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/products"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
          title="Back to products"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-semibold">New product</h1>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <ProductFields
          values={values}
          onChange={onChange}
          disabled={isPending}
          fieldErrors={fieldErrors}
        />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit || isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Creating…" : "Create product"}
        </Button>
        <Link href="/products">
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
