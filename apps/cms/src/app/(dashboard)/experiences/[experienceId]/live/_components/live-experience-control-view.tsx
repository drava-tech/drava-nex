"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  WifiOff,
  Layers,
  RotateCcw,
  Ban,
  Play,
  Lock,
  Unlock,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Loader2,
} from "lucide-react";
import { useScreenControls } from "@/hooks/useScreenControls";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { SCREEN_TO_CAMERA } from "@/lib/display/camera-config";
import { CameraStatusBadge } from "@/components/camera-status-badge";
import { ScreenMirror } from "@/app/(dashboard)/screens/_components/screen-mirror";
import { ScreenTouchpad } from "@/app/(dashboard)/screens/_components/screen-touchpad";
import { ScreenAssignmentPicker } from "@/app/(dashboard)/screens/_components/screens-assignment-picker";
import { LiveScreenSwitcher, type LiveScreenOption } from "./live-screen-switcher";
import type { WsContent } from "@platform/types";

interface LiveExperienceControlViewProps {
  experienceId: string;
  experienceName: string;
  deviceId: string;
  screenName: string;
  experiences: { id: string; title: string }[];
  initialBlanked?: boolean;
  initialInteractionEnabled?: boolean;
  initialShowTouchpad?: boolean;
  initialQueueMediaIds?: string[];
  initialQueueIndex?: number;
  liveScreens: LiveScreenOption[];
}

/**
 * Premium, experience-scoped live control workspace — the operator console
 * reached from the Experiences grid's "Control" action. Built entirely from
 * the same primitives as /screens/:deviceId (ScreenMirror/ScreenTouchpad,
 * useScreenControls, screen-actions) so both surfaces share one source of
 * truth; this view only differs in layout/skin (bottom transport dock,
 * always-dark broadcast-console chrome) and the experience-scoped header with
 * a screen switcher.
 */
export function LiveExperienceControlView({
  experienceId,
  experienceName,
  deviceId,
  screenName,
  experiences,
  initialBlanked = false,
  initialInteractionEnabled = true,
  initialShowTouchpad = false,
  initialQueueMediaIds,
  initialQueueIndex = 0,
  liveScreens,
}: LiveExperienceControlViewProps) {
  const router = useRouter();
  const [showPicker, setShowPicker] = useState(false);
  const mirrorFrameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Exact pixel size for the 16:9 mirror box, measured off the stage's real
  // content-box size (padding excluded) instead of CSS aspect-ratio/percentage
  // heights, which don't reliably shrink both dimensions together through this
  // flex-1/min-h-0 chain. null until first measured — the box falls back to
  // the old width-driven CSS sizing until then, so it's never invisible.
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const width = el.clientWidth - padX;
      const height = el.clientHeight - padY;
      if (width > 0 && height > 0) setStageSize({ width, height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Largest 16:9 box that fits the measured stage, capped at 1600px wide —
  // shrinking either dimension always shrinks the other to match.
  const boxWidth = stageSize ? Math.min(stageSize.width, 1600, stageSize.height * (16 / 9)) : null;
  const boxHeight = boxWidth !== null ? boxWidth * (9 / 16) : null;

  const {
    online,
    cameraStatus,
    showTouchpad,
    blanked,
    togglingBlank,
    toggleBlank,
    interactionEnabled,
    togglingInteraction,
    toggleInteraction,
    resetting,
    resetDetection,
    resettingToIdle,
    resetToIdle: resetToIdleAction,
    queueIndex,
    navigatingQueue,
    navigateQueue,
  } = useScreenControls({
    screenId: deviceId,
    initialBlanked,
    initialInteractionEnabled,
    initialShowTouchpad,
    queueMediaIds: initialQueueMediaIds,
    initialQueueIndex,
  });

  const hasQueue = Boolean(initialQueueMediaIds && initialQueueMediaIds.length > 0);

  const handleAssign = async (content: WsContent) => {
    setShowPicker(false);
    if (content.type === "video" || content.type === "image") {
      await assignMedia(deviceId, content.id);
      // No experience applies anymore — this page can't represent that state.
      router.push(`/screens/${deviceId}`);
    } else {
      await assignExperience(deviceId, content.id);
      // content.id is the newly assigned experience's id — keep the URL in
      // sync with what's actually live instead of pointing at the old one.
      router.push(`/experiences/${content.id}/live/${deviceId}`);
    }
  };

  const handleResetToIdle = async () => {
    await resetToIdleAction();
    router.push(`/screens/${deviceId}`);
  };

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === mirrorFrameRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      mirrorFrameRef.current?.requestFullscreen();
    }
  };

  return (
    <div className="dark relative flex-1 flex flex-col min-h-0 overflow-hidden bg-zinc-950">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${online ? "bg-green-500/10 text-green-400" : "bg-zinc-500/10 text-zinc-500"
              }`}
          >
            {online ? (
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e] animate-pulse" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {online ? "Live" : "Offline"}
          </span>
          <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/40 sm:inline">
            {experienceName}
          </span>
          <div className="min-w-0 border-l border-white/10 pl-3">
            <LiveScreenSwitcher
              experienceId={experienceId}
              activeScreenId={deviceId}
              activeScreenName={screenName}
              activeScreenOnline={online}
              screens={liveScreens}
            />
          </div>
          {cameraStatus && <CameraStatusBadge status={cameraStatus} />}
        </div>
        {!online && (
          <p className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-amber-400 md:block">
            Offline — showing last known state
          </p>
        )}
      </div>

      {/* Mirror stage */}
      <div ref={stageRef} className="relative flex flex-1 min-h-0 items-center justify-center overflow-hidden p-4">
        {showTouchpad ? (
          <div className="relative flex h-full min-h-0 w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border-[3px] border-zinc-800 shadow-2xl">
            <ScreenTouchpad screenId={deviceId} />
          </div>
        ) : (
          <div
            ref={mirrorFrameRef}
            style={
              isFullscreen || boxWidth === null || boxHeight === null
                ? undefined
                : { width: boxWidth, height: boxHeight }
            }
            className={
              isFullscreen
                ? "fixed inset-0 z-50 flex items-center justify-center bg-black"
                : `relative w-full max-w-[1600px] aspect-[16/9] max-h-full overflow-hidden rounded-2xl border-[6px] shadow-2xl transition-[opacity,filter] ${online
                  ? "border-zinc-800 shadow-[0_0_60px_-15px_rgba(34,197,94,0.35)]"
                  : "border-zinc-800/60 opacity-75 grayscale-[0.35]"
                }`
            }
          >
            {isFullscreen ? (
              <div className="relative bg-black" style={{ width: "min(100vw, 177.78vh)", height: "min(100vh, 56.25vw)" }}>
                <ScreenMirror screenId={deviceId} title={screenName} interactive />
                <button
                  onClick={toggleFullscreen}
                  title="Exit full screen"
                  className="absolute right-4 top-4 z-20 rounded-xl bg-black/50 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                >
                  <Minimize className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <ScreenMirror screenId={deviceId} title={screenName} interactive />
            )}

            {blanked && !isFullscreen && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70">
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/70">Screen blanked</span>
              </div>
            )}
            {!online && !isFullscreen && (
              <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-amber-400 backdrop-blur-sm">
                Offline — last known state
              </span>
            )}
          </div>
        )}
      </div>

      {/* Control dock — fixed height, never scrolls; buttons drop their
          labels (icon-only + tooltip) below md so the whole row always fits
          a single line, even on a tablet in portrait. */}
      <div className="shrink-0 border-t border-white/10 bg-black/50 px-2 py-2 backdrop-blur-xl md:px-6">
        <div className="flex items-center justify-between gap-1 md:gap-2">
          {/* Left cluster */}
          <div className="flex items-center gap-1">
            {SCREEN_TO_CAMERA[deviceId] && (
              <DockButton
                icon={<RotateCcw className="h-5 w-5" />}
                label={resetting ? "Resetting…" : "Reset detection"}
                onClick={resetDetection}
                disabled={resetting}
                tone="danger"
              />
            )}
            <DockButton
              icon={<RotateCcw className="h-5 w-5" />}
              label={resettingToIdle ? "Resetting…" : "Reset to idle"}
              onClick={handleResetToIdle}
              disabled={resettingToIdle}
            />
          </div>

          {/* Center cluster */}
          <div className="flex items-center gap-1">
            {hasQueue && (
              <div className="flex items-center gap-0.5 rounded-xl bg-white/5 px-1 py-1 md:gap-1">
                <button
                  onClick={() => navigateQueue("prev")}
                  disabled={navigatingQueue || queueIndex === 0}
                  title="Previous item"
                  className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 md:p-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[2.5rem] text-center text-[10px] font-bold uppercase tracking-wider text-white/50 md:min-w-[3.5rem]">
                  {queueIndex + 1} / {initialQueueMediaIds!.length}
                </span>
                <button
                  onClick={() => navigateQueue("next")}
                  disabled={navigatingQueue || queueIndex === initialQueueMediaIds!.length - 1}
                  title="Next item"
                  className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 md:p-2"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            {!showTouchpad && (
              <DockButton
                icon={isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                label={isFullscreen ? "Exit full screen" : "Full screen"}
                onClick={toggleFullscreen}
              />
            )}
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-1">
            <DockButton
              icon={interactionEnabled ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
              label={togglingInteraction ? "…" : interactionEnabled ? "Controls on" : "Controls off"}
              onClick={toggleInteraction}
              disabled={togglingInteraction}
              tone={interactionEnabled ? "default" : "warning"}
            />
            <DockButton
              icon={togglingBlank ? <Loader2 className="h-5 w-5 animate-spin" /> : blanked ? <Play className="h-5 w-5" /> : <Ban className="h-5 w-5" />}
              label={togglingBlank ? "…" : blanked ? "Resume" : "Blank"}
              onClick={toggleBlank}
              disabled={togglingBlank}
              tone={blanked ? "danger" : "default"}
            />
            <button
              onClick={() => setShowPicker(true)}
              title="Change content"
              className="flex min-w-[40px] items-center justify-center gap-1.5 rounded-xl bg-white px-2.5 py-1.5 text-zinc-950 transition-colors hover:bg-zinc-200 md:px-4 md:py-2"
            >
              <Layers className="h-5 w-5" />
              <span className="hidden text-[9px] font-bold uppercase tracking-widest md:inline">Change content</span>
            </button>
          </div>
        </div>
      </div>

      {showPicker && (
        <ScreenAssignmentPicker
          screenName={screenName}
          experiences={experiences}
          onAssign={handleAssign}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

function DockButton({
  icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "warning";
}) {
  const toneClasses =
    tone === "danger"
      ? "text-red-400 hover:bg-red-500/10"
      : tone === "warning"
        ? "text-amber-400 hover:bg-amber-500/10"
        : "text-white/70 hover:bg-white/10 hover:text-white";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex min-w-[40px] items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 transition-colors active:scale-95 disabled:opacity-40 disabled:active:scale-100 md:min-w-[64px] md:px-3 md:py-2 ${toneClasses}`}
    >
      {icon}
      <span className="hidden whitespace-nowrap text-[9px] font-bold uppercase tracking-widest md:inline">
        {label}
      </span>
    </button>
  );
}
