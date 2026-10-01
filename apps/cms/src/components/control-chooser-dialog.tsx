"use client";

import { Radio, X } from "lucide-react";
import type { LiveScreen } from "./live-control-dialog";

interface ControlChooserDialogProps {
  contentName: string;
  screens: LiveScreen[];
  onChoose: (screen: LiveScreen) => void;
  onClose: () => void;
}

/**
 * Shown right after pushing to 2+ screens at once — control only mirrors one
 * screen at a time, so ask which one before opening LiveControlDialog.
 */
export function ControlChooserDialog({ contentName, screens, onChoose, onClose }: ControlChooserDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 select-none"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" />

      <div
        className="relative w-full max-w-md bg-card text-card-foreground border border-border rounded-t-3xl md:rounded-3xl p-6 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden transition-all transform scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[9px] font-bold text-muted-foreground tracking-[0.25em] uppercase mb-0.5">
              Pushed &ldquo;{contentName}&rdquo; to {screens.length} screens
            </p>
            <h2 className="text-base font-bold text-foreground tracking-wide uppercase">
              Which screen do you want to control?
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {screens.map((s) => (
            <button
              key={s.screenId}
              type="button"
              onClick={() => onChoose(s)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-accent/40 hover:border-primary/50 hover:bg-accent p-4 text-left transition-all"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  s.isOnline ? "bg-[#4DDD00] animate-pulse shadow-[0_0_8px_#4DDD00]" : "bg-muted-foreground/40"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-foreground">
                  {s.screenName}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {s.isOnline ? "Online" : "Offline"}
                </span>
              </span>
              <Radio className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
