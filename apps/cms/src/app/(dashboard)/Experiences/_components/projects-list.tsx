"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Check,
  Loader2,
  MoreVertical,
  Pencil,
  Eye,
  Trash2,
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
import { reorderExperiences, deleteProject } from "@/actions/project-actions";
import { assignExperienceTemplate } from "@/actions/experience-actions";
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
}

const withTypeIds = (
  list: (Experience & { typeIds?: string[]; coverImage?: string | null })[]
): ExperienceWithTypes[] => list.map((p) => ({ ...p, typeIds: p.typeIds ?? [] }));

/**
 * One distinct hue per pill position (cycles beyond 9).
 * `base` fills imageless pills, `tint` washes over cover images so every
 * pill still reads its color, `hex` drives the glass rim + colored bloom.
 */
const PILL_STYLES = [
  { hex: "#8b5cf6", base: "from-zinc-950 via-violet-950/70 to-violet-500", tint: "from-black/45 via-violet-900/20 to-violet-500/75" },
  { hex: "#0ea5e9", base: "from-zinc-950 via-sky-950/70 to-sky-500", tint: "from-black/45 via-sky-900/20 to-sky-500/75" },
  { hex: "#10b981", base: "from-zinc-950 via-emerald-950/70 to-emerald-500", tint: "from-black/45 via-emerald-900/20 to-emerald-500/75" },
  { hex: "#f59e0b", base: "from-zinc-950 via-amber-950/70 to-amber-500", tint: "from-black/45 via-amber-900/20 to-amber-500/75" },
  { hex: "#f43f5e", base: "from-zinc-950 via-rose-950/70 to-rose-500", tint: "from-black/45 via-rose-900/20 to-rose-500/75" },
  { hex: "#06b6d4", base: "from-zinc-950 via-cyan-950/70 to-cyan-500", tint: "from-black/45 via-cyan-900/20 to-cyan-500/75" },
  { hex: "#d946ef", base: "from-zinc-950 via-fuchsia-950/70 to-fuchsia-500", tint: "from-black/45 via-fuchsia-900/20 to-fuchsia-500/75" },
  { hex: "#84cc16", base: "from-zinc-950 via-lime-950/70 to-lime-500", tint: "from-black/45 via-lime-900/20 to-lime-500/75" },
  { hex: "#f97316", base: "from-zinc-950 via-orange-950/70 to-orange-500", tint: "from-black/45 via-orange-900/20 to-orange-500/75" },
];

interface SortableCardProps {
  proj: ExperienceWithTypes;
  index: number;
  isAdmin?: boolean;
  dragEnabled?: boolean;
  onDelete: (id: string) => void;
}

function SortableCard({ proj, index, isAdmin, dragEnabled = false, onDelete }: SortableCardProps) {
  const router = useRouter();
  const [, startAssign] = useTransition();
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

  const num = String(index + 1).padStart(2, "0");
  const pal = PILL_STYLES[index % PILL_STYLES.length]!;
  // Alternate which end the number/name (and glow) sit on: odd pills up, even down.
  const dropped = index % 2 === 1;

  return (
    <div
      ref={setNodeRef}
      style={style}
      // The whole card is the drag handle (admins, when not filtering); the kebab is the only control.
      {...(dragEnabled ? { ...attributes, ...listeners } : {})}
      className={cn(
        "group relative select-none",
        dragEnabled && "cursor-grab active:cursor-grabbing"
      )}
    >
      {/* Arch / pill frame — flat hue capsule; bright end follows the number. */}
      <div className="relative aspect-[10/19] w-full overflow-hidden rounded-full bg-zinc-900">
        {/* Pure hue gradient — dark end → bright end (bright by the number) */}
        <div className={cn("absolute inset-0", dropped ? "bg-gradient-to-t" : "bg-gradient-to-b", pal.base)} />

        {/* Smoky glass body — darker center */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_55%,rgba(0,0,0,0.22),transparent_72%)]" />

        {/* Deepen the dark end (opposite the number) */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 from-transparent via-transparent to-black/30",
            dropped ? "bg-gradient-to-b" : "bg-gradient-to-t"
          )}
        />

        {/* Actions menu — the 3 dots at the end opposite the number.
            Edit / Preview / Assign template / Delete. Admins only. */}
        {isAdmin && (
          <div
            className={cn(
              "absolute left-1/2 z-20 -translate-x-1/2 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100",
              dropped ? "bottom-6" : "top-6"
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Experience actions"
                  // Don't let a click on the menu start a card drag.
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/25"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-52" onPointerDown={(e) => e.stopPropagation()}>
                {/* Edit / Preview need a template assigned */}
                {proj.templateKey ? (
                  <DropdownMenuItem asChild className="cursor-pointer gap-2">
                    <a href={`/edit/experiences/${proj.slug}`} target="_blank" rel="noopener noreferrer">
                      <Pencil className="h-4 w-4" /> Edit content
                    </a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="gap-2">
                    <Pencil className="h-4 w-4" /> Edit content
                  </DropdownMenuItem>
                )}
                {proj.templateKey ? (
                  <DropdownMenuItem asChild className="cursor-pointer gap-2">
                    <a href={`/preview/experiences/${proj.slug}`} target="_blank" rel="noopener noreferrer">
                      <Eye className="h-4 w-4" /> Preview
                    </a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="gap-2">
                    <Eye className="h-4 w-4" /> Preview
                  </DropdownMenuItem>
                )}

                {/* Assign / change template */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">Assign template</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {TEMPLATE_KEYS.map((key) => (
                      <DropdownMenuItem
                        key={key}
                        className="cursor-pointer gap-2"
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
                    <DropdownMenuItem className="cursor-pointer gap-2" onSelect={() => assign(null)}>
                      {!proj.templateKey ? <Check className="h-4 w-4" /> : <span className="w-4" />}
                      None
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                  onSelect={() => onDelete(proj.id)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Oversized index number + name — alternates top / bottom per pill.
          The digits are clipped to 60% height, emerging from the pill edge. */}
      <div
        className={cn(
          "pointer-events-none absolute -right-1 z-10 flex flex-col items-end text-right",
          dropped ? "top-4" : "bottom-4"
        )}
      >
        <span
          className="block h-[0.5em] overflow-hidden text-6xl font-black leading-none tracking-tighter text-white tabular-nums md:text-7xl"
          aria-hidden
        >
          {/* Top-aligned so only the lower half of each digit is clipped away */}
          <span className="block">{num}</span>
        </span>
        <span
          className="-mt-1 max-w-full break-words text-base font-black uppercase leading-[1.05] tracking-tight text-white md:text-xl"
          style={{ fontFamily: "'Satoshi', ui-sans-serif, system-ui, sans-serif" }}
        >
          {proj.name}
        </span>
      </div>
    </div>
  );
}

export function ProjectsList({ projects, isAdmin = false, experienceTypes = [] }: ProjectsListProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [items, setItems] = useState<ExperienceWithTypes[]>(() => withTypeIds(projects));
  const [saving, setSaving] = useState(false);
  const [filterTypeIds, setFilterTypeIds] = useState<string[]>([]);

  const isFiltering = filterTypeIds.length > 0;
  const dragEnabled = isAdmin && !isFiltering;

  const toggleFilter = (id: string) =>
    setFilterTypeIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );

  const filteredItems = isFiltering
    ? items.filter((p) => p.typeIds.some((t) => filterTypeIds.includes(t)))
    : items;

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
              <h1 className="text-xl font-semibold tracking-tight">Experiences</h1>
              <p className="text-sm text-muted-foreground">
                Manage your signage experiences
              </p>
            </div>
            <Badge variant="secondary" className="tabular-nums">
              {items.length}
            </Badge>
            {saving && (
              <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving order…
              </Badge>
            )}
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4" />
              New Experience
            </Button>
          )}
        </div>

        {/* Type filter */}
        {items.length > 0 && experienceTypes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Filter:</span>
            {experienceTypes.map((t) => {
              const active = filterTypeIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleFilter(t.id)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {active && <Check className="h-3 w-3" />}
                  {t.name}
                </button>
              );
            })}
            {isFiltering && (
              <button
                type="button"
                onClick={() => setFilterTypeIds([])}
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear
              </button>
            )}
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
              <p className="text-sm text-muted-foreground">No experiences yet</p>
              {isAdmin && (
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  Click to create your first experience
                </p>
              )}
            </div>
          </Card>
        ) : isFiltering && filteredItems.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-2 border-dashed bg-muted/30 p-12 text-center shadow-none">
            <p className="text-sm text-muted-foreground">
              No experiences match the selected type{filterTypeIds.length > 1 ? "s" : ""}.
            </p>
            <button
              type="button"
              onClick={() => setFilterTypeIds([])}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear filter
            </button>
          </Card>
        ) : (
          /* Dark showcase stage — staggered arch-pill cards with oversized indices */
          <div className="dark relative overflow-hidden rounded-[2rem] bg-zinc-950 px-6 py-10 md:px-10 md:py-14">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredItems.map((i) => i.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-2 items-start gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 xl:gap-x-8">
                  {filteredItems.map((proj, index) => (
                    <SortableCard
                      key={proj.id}
                      proj={proj}
                      index={index}
                      isAdmin={isAdmin}
                      dragEnabled={dragEnabled}
                      onDelete={handleDelete}
                    />
                  ))}

                  {isAdmin && !isFiltering && (
                    <button
                      type="button"
                      onClick={() => setShowModal(true)}
                      className="group/new relative"
                    >
                      <div className="flex aspect-[10/19] w-full flex-col items-center justify-center gap-3 rounded-full border border-dashed border-white/15 bg-white/5 text-zinc-500 backdrop-blur-sm transition-colors group-hover/new:border-white/35 group-hover/new:text-zinc-200">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur-md transition-colors group-hover/new:bg-white/20">
                          <Plus className="h-4 w-4" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em]">
                          New
                        </span>
                      </div>
                    </button>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>
    </>
  );
}
