"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { WsContent } from "@platform/types";

interface ContentPickerOverlayProps {
  apiUrl: string;
  onSelect: (content: WsContent) => void;
}

const LONG_PRESS_MS = 1000;
const AUTO_DISMISS_MS = 10_000;

export function ContentPickerOverlay({ apiUrl, onSelect }: ContentPickerOverlayProps) {
  const [open, setOpen] = useState(false);
  const [contents, setContents] = useState<WsContent[]>([]);
  const [loading, setLoading] = useState(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPicker = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/contents`);
      const data = await res.json();
      const items: WsContent[] = (data.contents ?? []).map((c: {
        id: string; type?: string; source: string; loop?: boolean; muted?: boolean;
      }) => ({
        id: c.id,
        type: (c.type ?? "video") as WsContent["type"],
        source: c.source,
        loop: c.loop,
        muted: c.muted,
      }));
      setContents(items);
    } catch {
      setContents([]);
    } finally {
      setLoading(false);
    }

    // Auto-dismiss after inactivity
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setOpen(false), AUTO_DISMISS_MS);
  }, [apiUrl]);

  const handleSelect = (content: WsContent) => {
    onSelect(content);
    setOpen(false);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  };

  // Long-press detection on the whole screen
  const onPointerDown = useCallback(() => {
    pressTimerRef.current = setTimeout(openPicker, LONG_PRESS_MS);
  }, [openPicker]);

  const onPointerUp = useCallback(() => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  return (
    <>
      {/* Invisible overlay that captures long-press */}
      {!open && (
        <div
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ position: "fixed", inset: 0, zIndex: 10, touchAction: "none" }}
        />
      )}

      {/* Content picker bottom sheet */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#111",
              borderRadius: "24px 24px 0 0",
              padding: "24px",
              maxHeight: "60vh",
              overflowY: "auto",
            }}
          >
            <p style={{
              color: "#9ca3af",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: "16px",
            }}>
              Select Content
            </p>

            {loading ? (
              <p style={{ color: "#6b7280", fontSize: "14px" }}>Loading…</p>
            ) : contents.length === 0 ? (
              <p style={{ color: "#6b7280", fontSize: "14px" }}>No content available</p>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "12px",
              }}>
                {contents.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleSelect(c)}
                    style={{
                      background: "#1f2937",
                      border: "1px solid #374151",
                      borderRadius: "12px",
                      padding: "12px",
                      color: "#e5e7eb",
                      fontSize: "12px",
                      fontWeight: 600,
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    <span style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "#6b7280",
                    }}>
                      {c.type}
                    </span>
                    <span style={{ wordBreak: "break-all" }}>{c.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
