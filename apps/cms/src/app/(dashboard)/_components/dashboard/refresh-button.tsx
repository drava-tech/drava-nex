"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshButton() {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  return (
    <button
      type="button"
      aria-label="Refresh dashboard"
      onClick={() => {
        setSpinning(true);
        router.refresh();
        setTimeout(() => setSpinning(false), 600);
      }}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#432992] bg-transparent transition-all duration-200 hover:-translate-y-0.5"
    >
      <RefreshCw className={`h-4 w-4 text-white ${spinning ? "animate-spin" : ""}`} />
    </button>
  );
}
