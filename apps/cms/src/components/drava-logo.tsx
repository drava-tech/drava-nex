// No imports on purpose: the auth layout renders this as a Server Component,
// and @platform/ui's barrel pulls in client-only modules (sidebar context).
function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/**
 * The drava symbol: a half-sliced "D" that becomes a smile. Same geometry as
 * Drava Core (apps/web/src/components/shared/drava-logo.tsx and the mobile
 * app's DravaMark): two E-squares on top and a quarter ring centred on the
 * first square's corner. Lime in dark mode; the leaf-green primary-ink in
 * light, where lime on Frost would barely show.
 */
export function DravaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={cn("size-6 shrink-0 fill-primary-ink", className)}>
      <rect x={0} y={0} width={28} height={28} />
      <rect x={44} y={0} width={28} height={28} />
      <path d="M72 28H100A72 72 0 0 1 28 100V72A44 44 0 0 0 72 28Z" />
    </svg>
  );
}

/**
 * Logo lockup: symbol + lowercase wordmark, with the product name after it
 * ("drava nex"). Size it with the text size, e.g. `text-2xl`.
 */
export function DravaLogo({ product, className }: { product?: string; className?: string }) {
  return (
    <span
      aria-label={product ? `drava ${product}` : "drava"}
      role="img"
      className={cn("inline-flex items-end gap-[0.3em] text-2xl leading-none", className)}
    >
      <DravaMark className="size-[0.74em]" />
      <span className="font-heading font-normal leading-[0.8] text-[#393b3d] dark:text-[#c3c3cb]">drava</span>
      {product && (
        <span className="font-heading font-normal leading-[0.8] text-muted-foreground">{product}</span>
      )}
    </span>
  );
}
