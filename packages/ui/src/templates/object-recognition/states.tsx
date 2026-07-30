// Full-surface state screens for the Object Recognition template. Rendered at
// the 1920x1080 design size inside ScreenStage, so a screen never shows a
// blank wall while the mat has nothing on it or camera data hasn't arrived yet.

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

export function ObjectRecognitionEmpty() {
  return (
    <StateShell>
      <p className="text-[44px] font-semibold">Nothing on the mat</p>
      <p className="max-w-[1100px] text-[26px] text-zinc-400">
        Place a product on the mat to see it here.
      </p>
    </StateShell>
  );
}

export function ObjectRecognitionError({ message }: { message?: string }) {
  return (
    <StateShell accent="text-red-300">
      <p className="text-[44px] font-semibold">Unable to load mat inventory</p>
      <p className="max-w-[1100px] text-[26px] text-zinc-400">
        {message ?? "The mat contents could not be loaded. It will retry automatically."}
      </p>
    </StateShell>
  );
}
