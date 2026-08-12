"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Check,
  Loader2,
  Pencil,
  Eye,
  Trash2,
  MonitorPlay,
  MoreVertical,
  Radio,
  Search,
  Tags,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  cn,
} from "@platform/ui";
import { CreateProjectModal } from "./create-project-modal";
import { EditExperienceModal } from "./edit-experience-modal";
import { PageHeader, HEADER_BUTTON } from "@/app/(dashboard)/_components/page-header";
import { PushToScreenModal, type ScreenRow } from "@/components/push-to-screen-modal";
import { reorderExperiences, deleteProject } from "@/actions/project-actions";
import { assignExperienceTemplate } from "@/actions/experience-actions";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { TEMPLATE_KEYS, TEMPLATE_LABELS } from "@/lib/templates";
import type { Experience } from "@platform/db";

type ExperienceWithTypes = Experience & { typeIds: string[]; coverImage?: string | null };

interface ProjectsListProps {
  // typeIds is optional so callers that don't track types (e.g. the dashboard
  // container) can still pass plain experiences; it's normalized to [] below.
  // coverImage is resolved server-side from templateContent (see page.tsx).
  projects: (Experience & { typeIds?: string[]; coverImage?: string | null })[];
  isAdmin?: boolean;
  experienceTypes?: { id: string; name: string }[];
  screens?: ScreenRow[];
  initialActiveScreenIds?: string[];
}

const withTypeIds = (
  list: (Experience & { typeIds?: string[]; coverImage?: string | null })[]
): ExperienceWithTypes[] => list.map((p) => ({ ...p, typeIds: p.typeIds ?? [] }));

const CARD =
  "rounded-2xl border border-[#6d5bc4]/45 bg-[linear-gradient(160deg,#0d0a1f_0%,#12102a_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,.04)] transition hover:border-[#8b6ff0]/80";
const PILL_ACTIVE =
  "border-[#a78bff] bg-[linear-gradient(90deg,rgba(60,43,111,.72),rgba(78,67,119,.78))] text-white shadow-[inset_0_0_18px_rgba(219,207,255,.19)]";
const PILL_IDLE =
  "border-[#6d5bc4]/45 bg-[#0f0c22] text-[#b3adc4] hover:border-[#8b6ff0]/70 hover:text-white";

interface SortableCardProps {
  proj: ExperienceWithTypes;
  isAdmin?: boolean;
  dragEnabled?: boolean;
  onDelete: (id: string) => void;
  screens: ScreenRow[];
  activeScreenIds: Set<string>;
  experienceTypes: { id: string; name: string }[];
}

function SortableCard({ proj, isAdmin, dragEnabled = false, onDelete, screens, activeScreenIds, experienceTypes }: SortableCardProps) {
  const router = useRouter();
  const [, startAssign] = React.useTransition();
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: proj.id, disabled: !dragEnabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 30 : undefined,
  };

  const assign = (key: string | null) =>
    startAssign(async () => {
      await assignExperienceTemplate(proj.id, key);
      router.refresh();
    });

  // Screens currently assigned this experience — shown regardless of whether
  // that screen's client happens to be connected right now (it still holds
  // this content and will display it once it reconnects).
  const assignedScreens = screens.filter(
    (s) => s.currentContentKind === "experience" && s.currentExperienceId === proj.id
  );
  const isLive = assignedScreens.length > 0;
  const isOnline = assignedScreens.some((s) => activeScreenIds.has(s.screenId));

  const templateLabel = proj.templateKey
    ? TEMPLATE_LABELS[proj.templateKey as keyof typeof TEMPLATE_LABELS] ?? proj.templateKey
    : "No template";

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...(dragEnabled ? { ...attributes, ...listeners } : {})}
        className={cn("group flex flex-col gap-3 select-none", CARD, dragEnabled && "cursor-grab active:cursor-grabbing")}
      >
        {/* Click opens the experience's detail/hub page (status, live screens,
            quick actions); the ⋮ menu keeps the direct shortcuts. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => router.push(`/experiences/${proj.id}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              router.push(`/experiences/${proj.id}`);
            }
          }}
          className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-[#6d5bc4]/35 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(96,68,200,.28),transparent_60%),linear-gradient(180deg,#14102c_0%,#0b0819_100%)]"
        >
          {proj.coverImage && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proj.coverImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
              <div className="absolute inset-0 bg-black/40" />
            </>
          )}

          {isLive && (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 backdrop-blur-sm">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isOnline ? "bg-[#4ade80] shadow-[0_0_6px_#22c55e]" : "bg-zinc-400"
                )}
              />
              <span className="max-w-[7rem] truncate text-[10px] uppercase tracking-[0.16em] text-white">
                {assignedScreens.length > 1
                  ? `${assignedScreens.length} screens`
                  : assignedScreens[0]?.screenName}
              </span>
            </div>
          )}

          <span className="relative z-10 flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", isOnline ? "bg-[#4ade80]" : isLive ? "bg-zinc-400" : "bg-[#4ade80]")} />
            <span className="text-[13px] text-[#b9a4ff]">{templateLabel}</span>
          </span>

          {/* Actions menu — Edit / Preview / Push to screen / Assign template / Delete. */}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Experience actions"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute right-1 top-1 z-20 flex size-8 items-center justify-center rounded-full text-[#b3adc4] transition hover:bg-white/10 hover:text-white"
                >
                  <MoreVertical className="size-4" strokeWidth={1.7} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52" onPointerDown={(e) => e.stopPropagation()}>
                {/* Edit / Preview need a template assigned */}
                {proj.templateKey ? (
                  <DropdownMenuItem asChild className="cursor-pointer gap-2 py-1">
                    <a href={`/edit/experiences/${proj.slug}`} target="_blank" rel="noopener noreferrer">
                      <Pencil className="h-4 w-4" /> Edit content
                    </a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="gap-2 py-1">
                    <Pencil className="h-4 w-4" /> Edit content
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="cursor-pointer gap-2 py-1"
                  onSelect={() => setShowEditModal(true)}
                >
                  <Tags className="h-4 w-4" /> Edit Experience
                </DropdownMenuItem>
                {proj.templateKey ? (
                  <DropdownMenuItem asChild className="cursor-pointer gap-2 py-1">
                    <a href={`/preview/experiences/${proj.slug}`} target="_blank" rel="noopener noreferrer">
                      <Eye className="h-4 w-4" /> Preview
                    </a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="gap-2 py-1">
                    <Eye className="h-4 w-4" /> Preview
                  </DropdownMenuItem>
                )}
                {isLive && (
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 py-1"
                    onSelect={() => {
                      const target =
                        assignedScreens.find((s) => activeScreenIds.has(s.screenId)) ?? assignedScreens[0];
                      if (target) router.push(`/experiences/${proj.id}/live/${target.screenId}`);
                    }}
                  >
                    <Radio className="h-4 w-4" /> Control{isOnline ? " (live)" : " (offline)"}
                  </DropdownMenuItem>
                )}
                {proj.templateKey ? (
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 py-1"
                    onSelect={() => setShowPushDialog(true)}
                  >
                    <MonitorPlay className="h-4 w-4" /> Push to screen
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="gap-2 py-1">
                    <MonitorPlay className="h-4 w-4" /> Push to screen
                  </DropdownMenuItem>
                )}

                {/* Assign / change template */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2 py-0">Assign template</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {TEMPLATE_KEYS.map((key) => (
                      <DropdownMenuItem
                        key={key}
                        className="cursor-pointer gap-2 py-1"
                        onSelect={() => assign(key)}
                      >
                        {proj.templateKey === key ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <span className="w-4" />
                        )}
                        {TEMPLATE_LABELS[key]}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="cursor-pointer gap-2 py-1" onSelect={() => assign(null)}>
                      {!proj.templateKey ? <Check className="h-4 w-4" /> : <span className="w-4" />}
                      None
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer gap-2 py-1 text-destructive focus:text-destructive"
                  onSelect={() => onDelete(proj.id)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="px-1">
          <p className="truncate text-[15px] text-white">{proj.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-[#8f89a6]">/{proj.slug}</p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 px-1 pb-1">
          <span className="truncate rounded-full bg-[#241c46] px-3 py-1.5 text-[12px] text-[#b3adc4]">
            {proj.templateKey ? templateLabel : "Untemplated"}
          </span>
          <a
            href={proj.templateKey ? `/edit/experiences/${proj.slug}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!proj.templateKey}
            onClick={(e) => {
              e.stopPropagation();
              if (!proj.templateKey) e.preventDefault();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "shrink-0 rounded-full border border-[#8c73d8]/70 px-4 py-1.5 text-[12px] text-[#e6e0ff] transition hover:bg-white/10",
              !proj.templateKey && "cursor-not-allowed opacity-40 hover:bg-transparent"
            )}
          >
            Edit
          </a>
        </div>
      </div>

      {showPushDialog && (
        <PushToScreenModal
          contentName={proj.name}
          onPush={(screenId) => assignExperience(screenId, proj.id)}
          isAlreadyShowing={(s) =>
            s.currentContentKind === "experience" && s.currentExperienceId === proj.id
          }
          onClose={() => setShowPushDialog(false)}
          onControl={(s) => {
            setShowPushDialog(false);
            router.push(`/experiences/${proj.id}/live/${s.screenId}`);
          }}
          onRemove={async (s) => {
            await assignMedia(s.screenId, null);
            router.refresh();
          }}
        />
      )}
      {showEditModal && (
        <EditExperienceModal
          experience={{
            id: proj.id,
            name: proj.name,
            slug: proj.slug,
            templateKey: proj.templateKey,
            typeIds: proj.typeIds,
          }}
          experienceTypes={experienceTypes}
          onClose={() => {
            setShowEditModal(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

export function ProjectsList({
  projects,
  isAdmin = false,
  experienceTypes = [],
  screens = [],
  initialActiveScreenIds = [],
}: ProjectsListProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [items, setItems] = useState<ExperienceWithTypes[]>(() => withTypeIds(projects));
  const [saving, setSaving] = useState(false);
  // null = "All"; "untemplated" = experiences with no template assigned.
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeScreenIds] = useState<Set<string>>(() => new Set(initialActiveScreenIds));

  const isFiltering = filter !== null || query.trim() !== "";
  const dragEnabled = isAdmin && !isFiltering;

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (filter === "untemplated" && p.templateKey) return false;
      if (filter && filter !== "untemplated" && p.templateKey !== filter) return false;
      if (!q) return true;
      return `${p.name} ${p.slug}`.toLowerCase().includes(q);
    });
  }, [items, filter, query]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  useEffect(() => {
    setItems(withTypeIds(projects));
  }, [projects]);

  const handleClose = () => {
    setShowModal(false);
    router.refresh();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    // Reordering a filtered subset would write wrong global positions — ignore.
    if (isFiltering) return;
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      const newItems = arrayMove(items, oldIndex, newIndex);

      setItems(newItems);
      setSaving(true);
      try {
        await reorderExperiences(newItems.map((i) => i.id));
        router.refresh();
      } catch (error) {
        console.error("Failed to reorder experiences:", error);
        // Rollback on failure
        setItems(withTypeIds(projects));
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this experience?")) return;
    try {
      const res = await deleteProject(id);
      if (res.success) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        router.refresh();
      } else {
        alert(res.error || "Failed to delete experience.");
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
      alert("An error occurred while deleting the experience.");
    }
  };

  const filters: { key: string | null; label: string }[] = [
    { key: null, label: "All" },
    ...TEMPLATE_KEYS.map((key) => ({ key: key as string, label: TEMPLATE_LABELS[key] })),
    { key: "untemplated", label: "Untemplated" },
  ];

  return (
    <>
      {showModal && (
        <CreateProjectModal onClose={handleClose} experienceTypes={experienceTypes} />
      )}

      <div className="flex w-full flex-col gap-5">
        <PageHeader
          title="Experiences"
          actions={
            isAdmin && (
              <button type="button" onClick={() => setShowModal(true)} className={HEADER_BUTTON}>
                <Plus className="size-4" strokeWidth={1.8} />
                New Experience
              </button>
            )
          }
        />

        {/* Template filter + search */}
        <div className="flex flex-wrap items-center gap-3">
          {filters.map((f) => (
            <button
              key={f.key ?? "all"}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "h-9 rounded-full border px-5 text-[14px] transition",
                filter === f.key ? PILL_ACTIVE : PILL_IDLE
              )}
            >
              {f.label}
            </button>
          ))}
          {saving && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#8f89a6]">
              <Loader2 className="size-3 animate-spin" />
              Saving order…
            </span>
          )}
          <label className="ml-auto flex h-10 min-w-[220px] items-center gap-2.5 rounded-full border border-[#6d5bc4]/45 bg-[#0f0c22] px-4 text-[#b3adc4]">
            <Search className="size-4 shrink-0" strokeWidth={1.6} />
            <input
              aria-label="Search experiences"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-[#8f89a6]"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              type="search"
              value={query}
            />
          </label>
        </div>

        {items.length === 0 ? (
          <button
            type="button"
            onClick={() => isAdmin && setShowModal(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#6d5bc4]/45 bg-[#0d0a1f] p-12 text-center",
              isAdmin && "transition hover:border-[#8b6ff0]/80"
            )}
          >
            {isAdmin && (
              <span className="flex size-10 items-center justify-center rounded-full border border-[#8c73d8]/70 text-[#c9b8ff]">
                <Plus className="size-5" />
              </span>
            )}
            <span className="text-[14px] text-[#8f89a6]">
              No experiences yet{isAdmin && " — click to create your first one"}
            </span>
          </button>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#6d5bc4]/45 bg-[#0d0a1f] p-12 text-center">
            <p className="text-[14px] text-[#8f89a6]">No experiences match this filter.</p>
            <button
              type="button"
              onClick={() => {
                setFilter(null);
                setQuery("");
              }}
              className="text-[13px] text-[#b9a4ff] underline-offset-2 hover:underline"
            >
              Clear filter
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filteredItems.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 items-stretch gap-5 md:grid-cols-3 xl:grid-cols-4">
                {filteredItems.map((proj) => (
                  <SortableCard
                    key={proj.id}
                    proj={proj}
                    isAdmin={isAdmin}
                    dragEnabled={dragEnabled}
                    onDelete={handleDelete}
                    screens={screens}
                    activeScreenIds={activeScreenIds}
                    experienceTypes={experienceTypes}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  );
}
