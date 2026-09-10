"use client";

import { useEffect } from "react";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { useAppDispatch } from "./hooks";
import { statusReceived } from "./audio-slice";
import { fetchAudioStatus } from "./audio-thunks";
import { screenContentUpdated, activeScreensUpdated } from "./screens-slice";

/**
 * The one place where server push becomes store actions.
 *
 * Renders nothing — it exists so a single WebSocket feeds every slice, rather
 * than each feature opening its own. The gateway broadcasts everything down
 * whichever socket is open (audio status, screen updates, media-library
 * invalidation, ...), so a second connection would only hear the same
 * announcements twice. That duplication is what this store replaced: four
 * components each held their own audio copy, and the CMS as a whole still opens
 * ~12 sockets for one broadcast stream.
 *
 * **When you add a slice, add a callback below — do not add a sibling
 * component next to this one**, or the connection count starts climbing again.
 *
 * Mounted once by StoreProvider, and must stay inside it: the hooks here read
 * react-redux's context.
 */
export function StoreSync() {
  const dispatch = useAppDispatch();

  useCmsScreenSync({
    onAudioStatusUpdate: (status) => { dispatch(statusReceived(status)); },
    // WsContent -> the row's language. getScreenContent (packages/db) only ever
    // sets type "experience" for an actual experience, so ANYTHING else is a
    // media asset — including "html", which is what PDFs, sheets, slides, Word
    // docs, YouTube and Drive links all arrive as (mediaAssetToWsContent
    // collapses them all to it). Testing for video/image instead misfiles every
    // one of those as an experience, which is the bug this replaced.
    onScreenUpdated: (screenId, content) => {
      dispatch(screenContentUpdated(
        content.type === "experience"
          ? { screenId, kind: "experience", id: content.id, title: content.title ?? null }
          : {
              screenId,
              kind: "media",
              id: content.id,
              title: content.title ?? null,
              // For "html" this is the wire type, not the asset's own
              // (document/sheet/...) — the wire doesn't carry that. The id is
              // the part that matters: it's what "already showing" dedupes on.
              mediaType: content.type,
              mediaUrl: content.source,
            },
      ));
    },
    onActiveScreensUpdated: (ids) => { dispatch(activeScreensUpdated(ids)); },
    // Next slices hang here, e.g.:
    //   onMediaLibraryUpdated: () => dispatch(mediaInvalidated()),
  });

  // Seed for first paint. The HTTP call itself lives with the rest of audio's
  // requests in audio-thunks.ts — this component only wires things together.
  useEffect(() => dispatch(fetchAudioStatus()), [dispatch]);

  return null;
}
