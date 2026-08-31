"use client";

import { useEffect, useState } from "react";
import { cn } from "@platform/ui";
import type { DocHeading } from "../_lib/docs-config";

export function DocsToc({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    if (headings.length === 0) return;

    const elements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        const first = visible[0];
        if (first) {
          setActiveId(first.target.id);
        }
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0 }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <aside className="sticky top-6 hidden h-fit w-56 shrink-0 self-start xl:block">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        On This Page
      </div>
      <ul className="space-y-2 border-l border-border">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={cn(
                "-ml-px block border-l-2 pl-3 text-sm transition-colors",
                activeId === heading.id
                  ? "border-accent font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
