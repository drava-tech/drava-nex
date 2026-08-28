import type { ReactNode } from "react";
import { Image as ImageIcon } from "lucide-react";

export function DocTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{children}</h1>;
}

export function DocLead({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-lg text-muted-foreground">{children}</p>;
}

export function DocH2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-6 text-2xl font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  );
}

export function DocP({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-7 text-foreground/90">{children}</p>;
}

export function DocList({ children }: { children: ReactNode }) {
  return <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-foreground/90">{children}</ul>;
}

export function DocScreenshot({ caption }: { caption: string }) {
  return (
    <div className="mt-4 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card text-muted-foreground">
      <ImageIcon className="h-8 w-8" />
      <span className="text-sm">Screenshot: {caption}</span>
    </div>
  );
}
