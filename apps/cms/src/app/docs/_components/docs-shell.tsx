"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { flatPages, pageBySlug } from "../_lib/docs-config";
import { DocsSidebar } from "./docs-sidebar";
import { DocsTopbar } from "./docs-topbar";
import { DocsToc } from "./docs-toc";

function slugFromPathname(pathname: string): string {
  return pathname.replace(/^\/docs\/?/, "");
}

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const slug = slugFromPathname(pathname);
  // flatPages is a non-empty compile-time constant (docsNav always has at
  // least the Introduction page), so this fallback is always defined.
  const page = pageBySlug.get(slug) ?? flatPages[0]!;
  const index = flatPages.findIndex((p) => p.slug === page.slug);
  const prev = index > 0 ? flatPages[index - 1] ?? null : null;
  const next = index < flatPages.length - 1 ? flatPages[index + 1] ?? null : null;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <DocsSidebar activeSlug={page.slug} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <DocsTopbar title={page.title} prev={prev} next={next} />
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl items-start gap-10 px-6 py-10 md:px-10">
            <main className="min-w-0 flex-1">{children}</main>
            <DocsToc key={page.slug} headings={page.headings} />
          </div>
        </div>
      </div>
    </div>
  );
}
