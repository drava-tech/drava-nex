"use client";

import { useEffect, useState } from "react";

/**
 * Full-bleed solid-black overlay, toggled by an admin's "Stop"/"Resume" action
 * (SCREEN_BLANK/SCREEN_UNBLANK commands, relayed by LiveScreenPlayer's
 * handleCommand as `screen-blank`/`screen-unblank` window events). One-directional
 * (CMS -> screen only) unlike WhiteboardScreenOverlay, so no local interaction
 * handling is needed here — just show/hide above everything else.
 */
export function BlackoutOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onBlank = () => setVisible(true);
    const onUnblank = () => setVisible(false);
    window.addEventListener("screen-blank", onBlank);
    window.addEventListener("screen-unblank", onUnblank);
    return () => {
      window.removeEventListener("screen-blank", onBlank);
      window.removeEventListener("screen-unblank", onUnblank);
    };
  }, []);

  if (!visible) return null;

  return <div className="fixed inset-0 z-50 bg-black" />;
}
