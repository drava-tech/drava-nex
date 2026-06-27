// Full-surface state screens for the Product Showcase template. Rendered at the
// 1920×1080 design size inside ScreenStage, so a screen never shows a blank wall
// while data is loading, missing, or unavailable.

import React from "react";

function StateShell({
  children,
  accent = "text-zinc-400",
}: {
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-zinc-950 px-24 text-center">
      <div className={`flex flex-col items-center gap-4 ${accent}`}>{children}</div>
    </div>
  );
}

export function ProductShowcaseLoading() {
  return (
    <StateShell>
      <div
        className="h-16 w-16 animate-spin rounded-full border-4 border-zinc-700 border-t-zinc-300"
        aria-hidden
      />
      <p className="text-[34px] font-medium tracking-wide">Loading product…</p>
    </StateShell>
  );
}

export function ProductShowcaseError({ message }: { message?: string }) {
  return (
    <StateShell accent="text-red-300">
      <p className="text-[44px] font-semibold">Unable to load product</p>
      <p className="max-w-[1100px] text-[26px] text-zinc-400">
        {message ?? "The product content could not be loaded. It will retry automatically."}
      </p>
    </StateShell>
  );
}

export function ProductShowcaseUnavailable({ name }: { name?: string }) {
  return (
    <StateShell accent="text-amber-200">
      <p className="text-[44px] font-semibold">Currently unavailable</p>
      <p className="max-w-[1100px] text-[26px] text-zinc-400">
        {name ? `“${name}” is not available right now.` : "This product is not available right now."}
      </p>
    </StateShell>
  );
}
