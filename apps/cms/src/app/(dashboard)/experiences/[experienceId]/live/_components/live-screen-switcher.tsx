"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@platform/ui";

export interface LiveScreenOption {
  screenId: string;
  screenName: string;
  isOnline: boolean;
}

interface LiveScreenSwitcherProps {
  experienceId: string;
  activeScreenId: string;
  activeScreenName: string;
  /** Live WS-derived online state for the active screen — more current than a server-fetched list. */
  activeScreenOnline: boolean;
  /**
   * Every screen currently live with this experience, per the server-fetched
   * list (may or may not include the active screen — e.g. it can be stale by
   * a few seconds, or the active screen may have since moved to different
   * content). The active screen is always shown first regardless.
   */
  screens: LiveScreenOption[];
}

/**
 * Screen name in the header doubles as a switcher when the experience is live
 * on more than one screen. Selection navigates to that screen's own URL
 * (/experiences/:experienceId/live/:screenId) instead of local state, so each
 * screen's control session stays bookmarkable/shareable and back/forward works.
 */
export function LiveScreenSwitcher({
  experienceId,
  activeScreenId,
  activeScreenName,
  activeScreenOnline,
  screens,
}: LiveScreenSwitcherProps) {
  const router = useRouter();
  const others = screens.filter((s) => s.screenId !== activeScreenId);

  if (others.length === 0) {
    return (
      <h1 className="truncate text-base font-bold tracking-wide text-white uppercase">{activeScreenName}</h1>
    );
  }

  const options: LiveScreenOption[] = [
    { screenId: activeScreenId, screenName: activeScreenName, isOnline: activeScreenOnline },
    ...others,
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="-mx-1.5 -my-1 flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/10"
        >
          <h1 className="truncate text-base font-bold tracking-wide text-white uppercase">{activeScreenName}</h1>
          <ChevronDown className="h-4 w-4 shrink-0 text-white/40" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
        {options.map((s) => (
          <DropdownMenuItem
            key={s.screenId}
            className="cursor-pointer gap-2"
            disabled={s.screenId === activeScreenId}
            onSelect={() => {
              if (s.screenId === activeScreenId) return;
              router.push(`/experiences/${experienceId}/live/${s.screenId}`);
            }}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.isOnline ? "bg-green-500" : "bg-zinc-400"}`} />
            <span className="truncate">{s.screenName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
