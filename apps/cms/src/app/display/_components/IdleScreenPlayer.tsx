"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { WsContent } from "@platform/types";
import { useScreenWebSocket } from "@/hooks/useScreenWebSocket";
import { IdleDisplay } from "./IdleDisplay";

interface IdleScreenPlayerProps {
  screenId: string;
  wsUrl: string;
}

export function IdleScreenPlayer({ screenId, wsUrl }: IdleScreenPlayerProps) {
  const router = useRouter();

  const handleContentUpdate = useCallback(
    (_content: WsContent) => {
      router.refresh();
    },
    [router]
  );

  const { status } = useScreenWebSocket({ screenId, onContentUpdate: handleContentUpdate, wsUrl });

  // Polling fallback when WS is disconnected — reads screens.json locally, no Hono needed
  useEffect(() => {
    if (status !== "disconnected") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/display-config/${screenId}`);
        if (!res.ok) return;
        const data: { content: WsContent | null } = await res.json();
        if (data.content) router.refresh();
      } catch { /* silent */ }
    }, 5_000);
    return () => clearInterval(interval);
  }, [status, screenId, router]);

  return <IdleDisplay screenId={screenId} />;
}
