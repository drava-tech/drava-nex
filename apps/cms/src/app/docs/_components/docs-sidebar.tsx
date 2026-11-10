"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { cn } from "@platform/ui";
import { docsNav, getDocPath } from "../_lib/docs-config";

export function DocsSidebar({ activeSlug }: { activeSlug: string }) {
  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex items-center gap-2 border-b border-sidebar-border px-6 py-5">
        <BookOpen className="h-5 w-5 text-accent" />
        <span className="font-semibold text-sidebar-foreground">Help</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-4 py-6">
        {docsNav.map((section) => (
          <div key={section.label} className="mb-6">
            <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.pages.map((page) => {
                const active = page.slug === activeSlug;
                return (
                  <li key={page.slug}>
                    <Link
                      href={getDocPath(page.slug)}
                      className={cn(
                        "block rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      )}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border px-4 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to CMS
        </Link>
      </div>
    </aside>
  );
}
