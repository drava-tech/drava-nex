"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Experience } from "@platform/db";
import { DravaWorldRenderer } from "@platform/ui/templates/drava-world";

/**
 * "Edit" for the Drava World template. There are no settings — the app is
 * shown exactly as the standalone one, and everything happens inside it — so
 * this is just Drava World full-screen with a way back to the CMS.
 */
export function DravaWorldEditorWorkspace({ experience }: { experience: Experience; initialContent: unknown }) {
  return (
    <div className="relative h-screen w-screen bg-[#07080b]">
      <DravaWorldRenderer />
      <Link
        href="/experiences"
        title={`Back to portfolio (${experience.name})`}
        aria-label="Back to portfolio"
        className="absolute bottom-4 left-4 rounded-full bg-black/60 p-2.5 text-white/80 backdrop-blur transition-colors hover:bg-black/80 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
    </div>
  );
}
