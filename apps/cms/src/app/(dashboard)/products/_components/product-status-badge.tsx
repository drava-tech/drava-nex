import { Badge } from "@platform/ui";
import type { ProductStatus } from "@platform/types";

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant="secondary" className="border-0 bg-zinc-100 dark:bg-white/10 font-medium text-zinc-600 dark:text-slate-300">
      {status}
    </Badge>
  );
}
