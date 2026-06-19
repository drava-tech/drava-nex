"use client";

import { useCallback, useEffect } from "react";
import type { WsContent } from "@platform/types";
import type { Content } from "@/types/display";
import { useScreenWebSocket } from "@/hooks/useScreenWebSocket";
import { useContentPreloader } from "@/hooks/useContentPreloader";
import { ContentRenderer } from "./ContentRenderer";
import { ContentPickerOverlay } from "./ContentPickerOverlay";
import { ContentTitleOverlay } from "./ContentTitleOverlay";

interface LiveScreenPlayerProps {
  screenId: string;
  initialContent: Content;
  wsUrl: string;
  apiUrl: string;
  pickerEnabled?: boolean;
}

// Map display Content → WsContent (for preloader + WS)
function toWsContent(c: Content): WsContent {
  const base = { id: c.id, type: c.type as WsContent["type"], source: (c as { source?: string }).source ?? "" };
  if (c.type === "video") return { ...base, loop: c.loop, muted: c.muted };
  return base;
}

// Map WsContent → display Content (for ContentRenderer)
function toDisplayContent(ws: WsContent): Content {
  switch (ws.type) {
    case "video":
      return { id: ws.id, type: "video", source: ws.source, loop: ws.loop ?? true, muted: ws.muted ?? true };
    case "image":
      return { id: ws.id, type: "image", source: ws.source };
    case "html":
      return { id: ws.id, type: "html", source: ws.source };
    case "stream":
      return { id: ws.id, type: "stream", source: ws.source, muted: ws.muted ?? true };
    default:
      return { id: ws.id, type: "video", source: (ws as WsContent).source, loop: true, muted: true };
  }
}

export function LiveScreenPlayer({
  screenId,
  initialContent,
  wsUrl,
  apiUrl,
  pickerEnabled = true,
}: LiveScreenPlayerProps) {
  const { activeContent, queueContent } = useContentPreloader(toWsContent(initialContent));

  const handleContentUpdate = useCallback(
    (incoming: WsContent) => queueContent(incoming),
    [queueContent]
  );

  const { status, sendContentChangeRequest } = useScreenWebSocket({
    screenId,
    onContentUpdate: handleContentUpdate,
    wsUrl,
  });

  // HTTP fallback: re-fetch config every 60s while WS is disconnected
  useEffect(() => {
    if (status !== "disconnected") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/api/screens/${screenId}/config`);
        if (res.ok) {
          const data = await res.json();
          if (data.content) queueContent(data.content);
        }
      } catch { /* silent */ }
    }, 60_000);
    return () => clearInterval(interval);
  }, [status, screenId, apiUrl, queueContent]);

  const displayContent = toDisplayContent(activeContent);

  return (
    <>
      <ContentRenderer content={displayContent} />
      {activeContent.title && <ContentTitleOverlay title={activeContent.title} />}
      {pickerEnabled && (
        <ContentPickerOverlay
          apiUrl={apiUrl}
          onSelect={(content) => {
            queueContent(content);
            sendContentChangeRequest(content);
          }}
        />
      )}
    </>
  );
}
