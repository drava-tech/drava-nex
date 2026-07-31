"use client";

import { useCallback, useRef, useState } from "react";
import { assignMedia } from "@/actions/screen-actions";
import { PushToScreenModal } from "@/components/push-to-screen-modal";

/**
 * Send whatever the Browser page is showing to one or more screens. Screen
 * selection, push, and the control panel are all the shared PushToScreenModal
 * — this component's only job is registering the URL as a (pending-save)
 * media asset once, then handing off a per-screen assign call.
 *
 * The page is registered as pending-save: an ad-hoc push shouldn't clutter
 * the Media Library on its own. It's still fully playable/assignable either
 * way — pending-save only hides it from the library listing until the admin
 * explicitly keeps it via the "Save link" action in the control panel that
 * opens right after pushing.
 */
export function PushPageDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const [mediaId, setMediaId] = useState<string | null>(null);
  // Multiple screens push in parallel (see PushToScreenModal), but the link
  // must only be registered once — every screen shows the same asset row
  // rather than a duplicate each.
  const registerPromiseRef = useRef<Promise<string> | null>(null);

  const registerLink = useCallback((): Promise<string> => {
    if (!registerPromiseRef.current) {
      registerPromiseRef.current = (async () => {
        const res = await fetch("/api/media/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, pendingSave: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error ?? "Could not push this page");
        const id = data.media.id as string;
        setMediaId(id);
        return id;
      })();
    }
    return registerPromiseRef.current;
  }, [url]);

  const handlePush = useCallback(
    async (screenId: string) => {
      const id = await registerLink();
      await assignMedia(screenId, id);
    },
    [registerLink]
  );

  const handleSaveLink = useCallback(async () => {
    if (!mediaId) return;
    const res = await fetch(`/api/media/${mediaId}/save`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error ?? "Could not save this link");
  }, [mediaId]);

  let hostLabel = url;
  try {
    hostLabel = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep the raw string */
  }

  return (
    <PushToScreenModal
      contentName={hostLabel}
      subtitle={
        <span className="block truncate" title={url}>
          {url}
        </span>
      }
      onPush={handlePush}
      onSaveLink={handleSaveLink}
      onClose={onClose}
      showTouchpad={!!mediaId}
    />
  );
}
