"use client";

import { useState, useTransition } from "react";
import { Loader2, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@platform/ui";
import { setVisionTriggerArmed } from "@/actions/vision-actions";

/**
 * Global, always-visible control in the shared dashboard header (every page,
 * not just Visitors) — arms/disarms the entrance-camera face detection that
 * switches the idle main screen to the Welcome experience. It's a site-wide
 * setting rather than something scoped to the Visitors page, so it lives in
 * the layout instead of being registered per-page.
 */
export function WelcomeTriggerToggle({ initialArmed }: { initialArmed: boolean }) {
  const [armed, setArmed] = useState(initialArmed);
  const [error, setError] = useState<string | null>(null);
  const [isToggling, startTransition] = useTransition();

  function toggle() {
    const next = !armed;
    setError(null);
    startTransition(async () => {
      try {
        setArmed(await setVisionTriggerArmed(next));
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={armed ? "active" : "secondary"}
        onClick={toggle}
        disabled={isToggling}
        className="gap-1.5"
        title="While armed, a detected face switches the idle main screen to the Welcome portfolio item"
      >
        {isToggling ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : armed ? (
          <ToggleRight className="h-4 w-4 text-green-400" />
        ) : (
          <ToggleLeft className="h-4 w-4 opacity-70" />
        )}
        <span>Welcome Trigger: {isToggling ? "…" : armed ? "ON" : "OFF"}</span>
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
