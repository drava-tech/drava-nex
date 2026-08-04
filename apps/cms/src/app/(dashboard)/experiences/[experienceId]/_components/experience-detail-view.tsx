"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Eye, MonitorPlay, Radio, Trash2, Tags, Wifi, WifiOff } from "lucide-react";
import { Badge, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, cn } from "@platform/ui";
import { EditExperienceModal } from "@/app/(dashboard)/experiences/_components/edit-experience-modal";
import { PushToScreenModal } from "@/components/push-to-screen-modal";
import { ScreenMirror } from "@/app/(dashboard)/screens/_components/screen-mirror";
import { assignExperience } from "@/actions/screen-actions";
import { deleteProject } from "@/actions/project-actions";
import { TEMPLATE_LABELS, isTemplateKey } from "@/lib/templates";

interface LiveScreenRow {
  screenId: string;
  screenName: string;
  isOnline: boolean;
}

interface ExperienceDetailViewProps {
  experience: {
    id: string;
    name: string;
    slug: string;
    templateKey: string | null;
    typeIds: string[];
    coverImage: string | null;
    createdAt: string;
  };
  isAdmin: boolean;
  experienceTypes: { id: string; name: string }[];
  liveScreens: LiveScreenRow[];
}

export function ExperienceDetailView({ experience, isAdmin, experienceTypes, liveScreens }: ExperienceDetailViewProps) {
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const hasTemplate = Boolean(experience.templateKey);
  const isLive = liveScreens.length > 0;
  const onlineCount = liveScreens.filter((s) => s.isOnline).length;
  const primaryLiveScreen = liveScreens.find((s) => s.isOnline) ?? liveScreens[0];
  // Grid sized to fill the available height (never scrolls) — up to 4
  // columns, wrapping into more rows as more screens go live.
  const gridCols = Math.min(liveScreens.length, 4);
  const gridRows = Math.ceil(liveScreens.length / gridCols) || 1;

  const handleDelete = async () => {
    if (!confirm(`Delete "${experience.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await deleteProject(experience.id);
      if (res.success) {
        router.push("/experiences");
      } else {
        alert(res.error || "Failed to delete experience.");
        setDeleting(false);
      }
    } catch (err) {
      console.error("Failed to delete experience:", err);
      alert("An error occurred while deleting the experience.");
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col min-h-0 gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{experience.name}</h1>
            <p className="text-sm text-muted-foreground">/{experience.slug}</p>
          </div>
          {hasTemplate && isTemplateKey(experience.templateKey) && (
            <Badge variant="secondary">{TEMPLATE_LABELS[experience.templateKey]}</Badge>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowEditModal(true)}>
              <Tags className="h-4 w-4" /> Edit experience
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
              <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex shrink-0 flex-wrap gap-2">
        {hasTemplate ? (
          <a
            href={`/edit/experiences/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Pencil className="h-4 w-4" /> Edit content
          </a>
        ) : (
          <Button variant="outline" disabled>
            <Pencil className="h-4 w-4" /> Edit content
          </Button>
        )}
        {hasTemplate ? (
          <a
            href={`/preview/experiences/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Eye className="h-4 w-4" /> Preview
          </a>
        ) : (
          <Button variant="outline" disabled>
            <Eye className="h-4 w-4" /> Preview
          </Button>
        )}
        <Button variant="outline" disabled={!hasTemplate} onClick={() => setShowPushModal(true)}>
          <MonitorPlay className="h-4 w-4" /> Push to screen
        </Button>
        {isLive && primaryLiveScreen && (
          <Button onClick={() => router.push(`/experiences/${experience.id}/live/${primaryLiveScreen.screenId}`)}>
            <Radio className="h-4 w-4" /> Control{onlineCount > 0 ? " (live)" : " (offline)"}
          </Button>
        )}
      </div>

      {/* Live status — fills whatever's left of the view; never scrolls, so
          every live screen is controllable at a glance. Tiles size off the
          grid's own row/column tracks (not a fixed aspect-ratio), so the
          whole set always fits the available space — ScreenStage inside
          each mirror already letterboxes to whatever box it's given. */}
      <Card className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle className="flex items-center gap-2 text-base">
            {isLive ? (
              <>
                <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e] animate-pulse" />
                Live on {liveScreens.length} screen{liveScreens.length > 1 ? "s" : ""}
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-zinc-400" />
                Not currently live
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-hidden">
          {isLive ? (
            <div
              className="grid h-full gap-3"
              style={{
                gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
              }}
            >
              {liveScreens.map((s) => (
                <button
                  key={s.screenId}
                  onClick={() => router.push(`/experiences/${experience.id}/live/${s.screenId}`)}
                  className="group flex min-h-0 flex-col overflow-hidden rounded-xl border border-border text-left transition-colors hover:border-primary"
                >
                  <div className="relative min-h-0 flex-1 bg-zinc-950">
                    <ScreenMirror screenId={s.screenId} title={s.screenName} />
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-2 p-2.5">
                    <span className="truncate text-sm font-medium">{s.screenName}</span>
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider",
                        s.isOnline ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      )}
                    >
                      {s.isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                      {s.isOnline ? "Online" : "Offline"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This experience isn&apos;t assigned to any screen right now.
              {hasTemplate ? " Push it to a screen to go live." : " Assign a template first, then push it to a screen."}
            </p>
          )}
        </CardContent>
      </Card>

      {showEditModal && (
        <EditExperienceModal
          experience={experience}
          experienceTypes={experienceTypes}
          onClose={() => {
            setShowEditModal(false);
            router.refresh();
          }}
        />
      )}

      {showPushModal && (
        <PushToScreenModal
          contentName={experience.name}
          onPush={(screenId) => assignExperience(screenId, experience.id)}
          isAlreadyShowing={(s) => s.currentContentKind === "experience" && s.currentExperienceId === experience.id}
          onClose={() => {
            setShowPushModal(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
