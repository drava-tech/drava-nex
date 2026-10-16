"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Experience } from "@platform/db";
import { DataArtStudioRenderer } from "@platform/ui/templates/data-art-studio";

/**
 * "Edit" for the Data Art Studio template. There are no settings — the studio
 * is shown exactly as the standalone app, and everything is chosen inside it —
 * so this is just the studio full-screen with a way back to the CMS.
 */
export function DataArtStudioEditorWorkspace({ experience }: { experience: Experience; initialContent: unknown }) {
  return (
    <div className="relative h-screen w-screen bg-[#05070a]">
      <DataArtStudioRenderer />
      <Link
        href="/experiences"
        title={`Back to experiences (${experience.name})`}
        aria-label="Back to experiences"
        className="absolute bottom-4 left-4 rounded-full bg-black/60 p-2.5 text-white/80 backdrop-blur transition-colors hover:bg-black/80 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
    </div>
  );
}
