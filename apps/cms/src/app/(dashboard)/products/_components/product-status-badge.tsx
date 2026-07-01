import { Badge, cn } from "@platform/ui";
import type { ProductStatus } from "@platform/types";

const STYLES: Record<ProductStatus, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  DRAFT: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20 dark:text-zinc-300",
  INACTIVE: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  ARCHIVED: "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400",
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STYLES[status])}>
      {status}
    </Badge>
  );
}
