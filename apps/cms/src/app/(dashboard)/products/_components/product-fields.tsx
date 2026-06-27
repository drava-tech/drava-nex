"use client";

import { PRODUCT_STATUSES, type FieldError, type ProductStatus } from "@platform/types";
import { Field, TextInput, TextArea, Select } from "./form-controls";

export interface ProductFormValues {
  name: string;
  slug: string;
  sku: string;
  brand: string;
  category: string;
  status: ProductStatus;
  detectionLabel: string;
  shortDescription: string;
  fullDescription: string;
}

export const EMPTY_PRODUCT_VALUES: ProductFormValues = {
  name: "",
  slug: "",
  sku: "",
  brand: "",
  category: "",
  status: "DRAFT",
  detectionLabel: "",
  shortDescription: "",
  fullDescription: "",
};

/** lowercase, spaces/dashes → single hyphen, strip invalid — for slugs. */
export function deriveSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** lowercase, spaces/dashes → underscore, strip invalid — for detection labels. */
export function normalizeDetectionLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const DETECTION_LABEL_RE = /^[a-z0-9_]+$/;

export function detectionLabelError(value: string): string | null {
  if (!value) return null;
  if (!DETECTION_LABEL_RE.test(value)) {
    return "Lowercase letters, numbers and underscores only (e.g. smart_glasses).";
  }
  return null;
}

function errorFor(fieldErrors: FieldError[] | undefined, field: string): string | undefined {
  return fieldErrors?.find((e) => e.field === field)?.message;
}

/**
 * The Basic Information, Camera Detection and Descriptions sections of the product
 * form. Controlled — used by both the create and edit screens.
 */
export function ProductFields({
  values,
  onChange,
  disabled,
  fieldErrors,
}: {
  values: ProductFormValues;
  onChange: (patch: Partial<ProductFormValues>) => void;
  disabled?: boolean;
  fieldErrors?: FieldError[];
}) {
  const labelError = detectionLabelError(values.detectionLabel) ?? errorFor(fieldErrors, "detectionLabel");

  return (
    <div className="flex flex-col gap-8">
      {/* Basic Information */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Basic information</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product name" required error={errorFor(fieldErrors, "name")}>
            <TextInput
              value={values.name}
              disabled={disabled}
              placeholder="Smart Glasses"
              onChange={(e) => {
                const name = e.target.value;
                // Keep slug in sync until the user has typed one manually.
                const patch: Partial<ProductFormValues> = { name };
                if (!values.slug || values.slug === deriveSlug(values.name)) {
                  patch.slug = deriveSlug(name);
                }
                onChange(patch);
              }}
            />
          </Field>
          <Field
            label="Slug"
            required
            hint={`/products/${values.slug || "…"}`}
            error={errorFor(fieldErrors, "slug")}
          >
            <TextInput
              value={values.slug}
              disabled={disabled}
              placeholder="smart-glasses"
              className="font-mono"
              onChange={(e) => onChange({ slug: e.target.value })}
            />
          </Field>
          <Field label="SKU" hint="Unique when provided" error={errorFor(fieldErrors, "sku")}>
            <TextInput
              value={values.sku}
              disabled={disabled}
              placeholder="SG-001"
              onChange={(e) => onChange({ sku: e.target.value })}
            />
          </Field>
          <Field label="Brand" error={errorFor(fieldErrors, "brand")}>
            <TextInput
              value={values.brand}
              disabled={disabled}
              placeholder="White Tusker"
              onChange={(e) => onChange({ brand: e.target.value })}
            />
          </Field>
          <Field label="Category" error={errorFor(fieldErrors, "category")}>
            <TextInput
              value={values.category}
              disabled={disabled}
              placeholder="Wearable Technology"
              onChange={(e) => onChange({ category: e.target.value })}
            />
          </Field>
          <Field label="Status" error={errorFor(fieldErrors, "status")}>
            <Select
              value={values.status}
              disabled={disabled}
              onChange={(e) => onChange({ status: e.target.value as ProductStatus })}
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      {/* Camera Detection */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Camera detection</h2>
        <Field
          label="Detection label"
          error={labelError ?? undefined}
          hint="Must match the vision model class name exactly. Unique when provided."
        >
          <div className="flex gap-2">
            <TextInput
              value={values.detectionLabel}
              disabled={disabled}
              placeholder="smart_glasses"
              className="font-mono"
              onChange={(e) => onChange({ detectionLabel: e.target.value })}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ detectionLabel: normalizeDetectionLabel(values.name) })}
              className="shrink-0 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
              title="Generate from product name"
            >
              From name
            </button>
          </div>
        </Field>
      </section>

      {/* Descriptions */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Descriptions</h2>
        <Field label="Short description" error={errorFor(fieldErrors, "shortDescription")}>
          <TextArea
            value={values.shortDescription}
            disabled={disabled}
            placeholder="One-line summary shown under the product name."
            onChange={(e) => onChange({ shortDescription: e.target.value })}
          />
        </Field>
        <Field label="Full description" error={errorFor(fieldErrors, "fullDescription")}>
          <TextArea
            value={values.fullDescription}
            disabled={disabled}
            className="min-h-[140px]"
            placeholder="Complete product description…"
            onChange={(e) => onChange({ fullDescription: e.target.value })}
          />
        </Field>
      </section>
    </div>
  );
}

/** Strip empty strings so optional fields are omitted (and slug/name stay required). */
export function valuesToInput(values: ProductFormValues) {
  const t = (s: string) => s.trim();
  return {
    name: t(values.name),
    slug: t(values.slug),
    sku: t(values.sku) || undefined,
    brand: t(values.brand) || undefined,
    category: t(values.category) || undefined,
    status: values.status,
    detectionLabel: t(values.detectionLabel) || undefined,
    shortDescription: t(values.shortDescription) || undefined,
    fullDescription: t(values.fullDescription) || undefined,
  };
}
