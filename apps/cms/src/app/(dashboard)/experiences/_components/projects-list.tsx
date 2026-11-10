"use client";

import React, { useState, useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Check,
  Loader2,
  Pencil,
  Eye,
  Trash2,
  MonitorPlay,
  Radio,
  Tags,
  MoreVertical,
  Search,
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
  Badge,
  Button,
  Card,
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
import { PushToScreenModal, type ScreenRow } from "@/components/push-to-screen-modal";
import { reorderExperiences, deleteProject } from "@/actions/project-actions";
import { assignExperienceTemplate } from "@/actions/experience-actions";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { TEMPLATE_KEYS, TEMPLATE_LABELS, type TemplateKey } from "@/lib/templates";
import type { Experience } from "@platform/db";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { activeScreensUpdated } from "@/store/screens-slice";

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

/** Category a card's filter pill / thumbnail label falls into — every real
 * template key, or "untemplated" for an experience with none assigned yet. */
type Category = TemplateKey | "untemplated";

const categoryLabel = (cat: Category) => (cat === "untemplated" ? "Untemplated" : TEMPLATE_LABELS[cat]);

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
  const [, startAssign] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draggableProps: Record<string, any> = dragEnabled ? { ...attributes, ...listeners } : {};

  // Screens currently assigned this experience — shown regardless of whether
  // that screen's client happens to be connected right now (it still holds
  // this content and will display it once it reconnects).
  const assignedScreens = screens.filter(
    (s) => s.currentContentKind === "experience" && s.currentExperienceId === proj.id
  );
  const isLive = assignedScreens.length > 0;
  const isOnline = assignedScreens.some((s) => activeScreenIds.has(s.screenId));
  const category: Category = proj.templateKey ? (proj.templateKey as TemplateKey) : "untemplated";

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all",
          "hover:ring-2 hover:ring-primary focus-within:ring-2 focus-within:ring-primary",
          dragEnabled && "cursor-grab active:cursor-grabbing"
        )}
        {...draggableProps}
      >
        {/* Thumbnail — a plain card container (not a button); click still opens
            the experience's detail/hub page, kept keyboard-accessible via
            role="button". Keeps its own two-tone fill as the padding-box layer
            while the shimmer paints the border-box layer beneath it. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => router.push(`/experiences/${proj.id}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") router.push(`/experiences/${proj.id}`);
          }}
          className="relative flex aspect-[5/4] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl outline-none bg-muted/40 hover:bg-muted/60 transition-colors"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            {categoryLabel(category)}
          </span>

          {isLive && (
            <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full border-0 bg-white/10 px-2.5 py-1 backdrop-blur-sm">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isOnline ? "bg-green-500 shadow-[0_0_6px_#22c55e] animate-pulse" : "bg-zinc-400"
                )}
              />
              <span className="text-[9px] font-light uppercase tracking-[0.15em] text-slate-300">
                {isOnline ? "Live" : "Offline"}
              </span>
            </span>
          )}
        </div>

        {/* Actions menu */}
        {isAdmin && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Portfolio item actions"
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full border-0 bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:text-white hover:bg-black/80"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
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
                    const target = assignedScreens.find((s) => activeScreenIds.has(s.screenId)) ?? assignedScreens[0];
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

        {/* Title + slug + category pill / Edit */}
        <div className="flex flex-col gap-3 p-4">
          <div>
            <p className="truncate text-base font-light text-white">{proj.name}</p>
            <p className="truncate text-sm text-white/40">/{proj.slug}</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant="secondary"
              className="rounded-full border-0 bg-white/10 px-3 py-1 text-[11px] font-light text-slate-300"
            >
              {categoryLabel(category)}
            </Badge>
            {proj.templateKey ? (
              <a
                href={`/edit/experiences/${proj.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-light text-white transition-colors hover:bg-white/10"
              >
                Edit
              </a>
            ) : (
              <span className="cursor-not-allowed rounded-full border border-white/10 px-4 py-1.5 text-xs font-light text-white/30">
                Edit
              </span>
            )}
          </div>
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
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  // From the store, so the online dots stay correct while the page is open.
  // This was a frozen useState seeded once from server props — it never updated,
  // so a screen going offline left a stale green dot until a full reload.
  const dispatch = useAppDispatch();
  const storeActiveIds = useAppSelector((st) => st.screens.activeIds);
  useEffect(() => { dispatch(activeScreensUpdated(initialActiveScreenIds)); }, [dispatch, initialActiveScreenIds]);
  const activeScreenIds = useMemo(
    () => new Set(storeActiveIds.length > 0 ? storeActiveIds : initialActiveScreenIds),
    [storeActiveIds, initialActiveScreenIds],
  );

  const isFiltering = categoryFilter !== "all";
  const dragEnabled = isAdmin && !isFiltering && search.trim() === "";

  // Only offer categories that actually have at least one experience —
  // "All" plus real template keys in their canonical order, "Untemplated" last.
  const availableCategories = useMemo(() => {
    const present = new Set<Category>(
      items.map((p) => (p.templateKey ? (p.templateKey as TemplateKey) : "untemplated"))
    );
    const ordered = TEMPLATE_KEYS.filter((k) => present.has(k)) as Category[];
    if (present.has("untemplated")) ordered.push("untemplated");
    return ordered;
  }, [items]);

  const filteredItems = items.filter((p) => {
    const category: Category = p.templateKey ? (p.templateKey as TemplateKey) : "untemplated";
    if (isFiltering && category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.slug.toLowerCase().includes(q)) return false;
    }
    return true;
  });

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
    if (isFiltering || search.trim()) return;
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
    if (!confirm("Delete this from the portfolio? This can't be undone.")) return;
    try {
      const res = await deleteProject(id);
      if (res.success) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        router.refresh();
      } else {
        alert(res.error || "Couldn't delete it from the portfolio.");
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
      alert("Something went wrong deleting it from the portfolio.");
    }
  };

  return (
    <>
      {showModal && (
        <CreateProjectModal onClose={handleClose} experienceTypes={experienceTypes} />
      )}

      <div className="flex flex-col gap-4 w-full">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-light tracking-tight">Portfolio</h1>
              <p className="text-sm font-light text-muted-foreground">
                Manage your signage experiences
              </p>
            </div>
            <Badge
              variant="secondary"
              className="border-0 bg-zinc-100 dark:bg-white/10 px-2.5 py-1 tabular-nums font-light text-zinc-600 dark:text-slate-300"
            >
              {items.length}
            </Badge>
            {saving && (
              <Badge
                variant="secondary"
                className="gap-1.5 rounded-xl border-0 bg-zinc-100 dark:bg-white/10 px-2.5 py-1 font-light text-zinc-600 dark:text-slate-300"
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving order…
              </Badge>
            )}
          </div>
          {isAdmin && (
            <Button size="pill" onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4" />
              New Experience
            </Button>
          )}
        </div>

        {/* Category filter + search */}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                aria-pressed={categoryFilter === "all"}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-light transition-colors",
                  categoryFilter === "all"
                    ? "btn-active"
                    : "btn-surface"
                )}
              >
                All
              </button>
              {availableCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  aria-pressed={categoryFilter === cat}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-light transition-colors",
                    categoryFilter === cat
                      ? "btn-active"
                      : "btn-surface"
                  )}
                >
                  {categoryLabel(cat)}
                </button>
              ))}
            </div>
            <div className="relative w-full max-w-[220px] sm:w-auto">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-full border border-white/15 bg-transparent py-1.5 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-violet-500"
              />
            </div>
          </div>
        )}

        {/* Empty state */}
        {items.length === 0 ? (
          <Card
            onClick={() => {
              if (isAdmin) setShowModal(true);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-4 border-dashed bg-muted/30 p-12 text-center shadow-none",
              isAdmin && "group cursor-pointer transition-colors hover:border-border hover:bg-muted/50"
            )}
          >
            {isAdmin && (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-foreground">
                <Plus className="h-5 w-5" />
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Nothing in the portfolio yet</p>
              {isAdmin && (
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  Click to create your first experience
                </p>
              )}
            </div>
          </Card>
        ) : filteredItems.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-2 border-dashed bg-muted/30 p-12 text-center shadow-none">
            <p className="text-sm text-muted-foreground">
              No experiences match your filter.
            </p>
            <button
              type="button"
              onClick={() => {
                setCategoryFilter("all");
                setSearch("");
              }}
              className="text-xs font-light text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear filter
            </button>
          </Card>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filteredItems.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

                {isAdmin && !isFiltering && !search.trim() && (
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="flex aspect-[5/4] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/5 text-zinc-500 backdrop-blur-sm transition-colors hover:border-white/35 hover:text-zinc-200 sm:aspect-auto sm:min-h-[220px]"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur-md">
                      <Plus className="h-4 w-4" />
                    </div>
                    <span className="text-[10px] font-light uppercase tracking-[0.2em]">
                      New
                    </span>
                  </button>
                )}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  );
}
