"use client";

import { Layers } from "lucide-react";
import { assignMediaQueue, advanceScreenQueue } from "@/actions/screen-actions";
import { PushToScreenModal } from "@/components/push-to-screen-modal";
import type { MediaItem } from "./media-preview-modal";

/**
 * Push an ordered set of media items to ONE screen as a queue, then Next/Prev
 * through them from the same LiveControlDialog session that opens right after
 * the push (see PushToScreenModal's `queue` prop). Restricted to a single
 * screen — a queue needs a live "N of M" indicator, and there's no UI here for
 * N independent indicators across multiple screens.
 */
export function MediaQueuePushModal({ items, onClose }: { items: MediaItem[]; onClose: () => void }) {
  const mediaAssetIds = items.map((item) => item.id);

  return (
    <PushToScreenModal
      contentName={`${items.length} item${items.length === 1 ? "" : "s"} selected`}
      onClose={onClose}
      preview={<QueueStackPreview items={items} />}
      subtitle={`Plays in the order selected · ${items.length} item${items.length === 1 ? "" : "s"}`}
      onPush={(screenId) => assignMediaQueue(screenId, mediaAssetIds, 0)}
      queue={{ mediaAssetIds, startIndex: 0, onNavigate: advanceScreenQueue }}
    />
  );
}

function QueueStackPreview({ items }: { items: MediaItem[] }) {
  const shown = items.slice(0, 6);
  const remaining = items.length - shown.length;
  return (
    <div className="grid max-h-full w-full max-w-2xl grid-cols-3 gap-3 p-6 overflow-y-auto">
      {shown.map((item, i) => (
        <div key={item.id} className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900">
          {item.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-500">
              <Layers className="h-8 w-8" />
            </div>
          )}
          <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/60 px-1 text-[10px] font-bold text-white">
            {i + 1}
          </span>
        </div>
      ))}
      {remaining > 0 && (
        <div className="flex aspect-video items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-zinc-400">
          +{remaining} more
        </div>
      )}
    </div>
  );
}
