"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getActiveScreens, getScreens } from "@/actions/screen-actions";
import { getScreenGroups } from "@/actions/screen-group-actions";
import type { ScreenRow } from "@/components/push-to-screen-modal";
import { PublishBoard } from "../../broadcast/_components/publish-board";

/** Our Story lists the 86" TV first; the same order here. */
const PRIMARY_SCREEN_NAME = "tv-86inch";

/**
 * One media item opened from the Media list, in Our Story's view: the screen
 * box on top, the media as swipeable cards below, starting on this item.
 * Hold and swipe a card up to put it on the screen in the box.
 */
export function MediaBoardView({ mediaId, onBack }: { mediaId: string; onBack: () => void }) {
  const [screens, setScreens] = useState<{
    rows: ScreenRow[];
    active: string[];
    groups: { id: string; name: string }[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getScreens(), getActiveScreens(), getScreenGroups().catch(() => [])])
      .then(([rows, active, groups]) => {
        if (cancelled) return;
        const isPrimary = (s: ScreenRow) => s.screenName.trim().toLowerCase() === PRIMARY_SCREEN_NAME;
        setScreens({ rows: [...rows].sort((a, b) => Number(isPrimary(b)) - Number(isPrimary(a))), active, groups });
      })
      .catch(() => !cancelled && setScreens({ rows: [], active: [], groups: [] }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 flex-col overflow-hidden bg-zinc-100 dark:bg-transparent">
      {screens === null ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <PublishBoard
          // A new board per item, so opening another starts on that one.
          key={mediaId}
          initialScreens={screens.rows}
          initialActiveScreenIds={screens.active}
          experiences={[]}
          experienceTypes={[]}
          screenGroups={screens.groups}
          focusMedia={{ id: mediaId, onBack }}
        />
      )}
    </div>
  );
}
