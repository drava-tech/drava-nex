"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@platform/ui";
import { getDocPath, type DocPage } from "../_lib/docs-config";

export function DocsTopbar({
  title,
  prev,
  next,
}: {
  title: string;
  prev: DocPage | null;
  next: DocPage | null;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-background px-6 py-3 md:px-10">
      <span className="text-sm font-medium text-muted-foreground">{title}</span>
      <div className="flex items-center gap-1">
        <NavArrow direction="prev" page={prev} />
        <NavArrow direction="next" page={next} />
      </div>
    </header>
  );
}

function NavArrow({ direction, page }: { direction: "prev" | "next"; page: DocPage | null }) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const className = cn(
    "flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors",
    page ? "hover:bg-accent hover:text-accent-foreground" : "pointer-events-none opacity-40"
  );

  if (!page) {
    return (
      <span className={className} aria-disabled="true">
        <Icon className="h-4 w-4" />
      </span>
    );
  }

  return (
    <Link href={getDocPath(page.slug)} aria-label={`${direction === "prev" ? "Previous" : "Next"}: ${page.title}`} className={className}>
      <Icon className="h-4 w-4" />
    </Link>
  );
}
