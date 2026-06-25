"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Pencil,
  Eye,
  MoreVertical,
  Check,
  Layers,
  Radio,
  Loader2,
  type LucideIcon,
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

interface ProjectsListProps {
  projects: Experience[];
  isAdmin?: boolean;
}

interface TemplateMeta {
  icon: LucideIcon | null;
  label: string;
  badge: string;
  number: string;
}

const NO_TEMPLATE_META: TemplateMeta = {
  icon: null,
  label: "No template",
  badge: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  number: "text-red-500/15 dark:text-red-400/30",
};

const TEMPLATE_META: Record<string, TemplateMeta> = {
  portfolio: {
    icon: Layers,
    label: TEMPLATE_LABELS.portfolio,
    badge: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400",
    number: "text-violet-500/15 dark:text-violet-400/30",
  },
  "live-stream": {
    icon: Radio,
    label: TEMPLATE_LABELS["live-stream"],
    badge: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    number: "text-sky-500/15 dark:text-sky-400/30",
  },
};

function getTemplateMeta(templateKey: string | null): TemplateMeta {
  if (!templateKey) return NO_TEMPLATE_META;
  return TEMPLATE_META[templateKey] ?? NO_TEMPLATE_META;
}

function TemplateBadge({ meta }: { meta: TemplateMeta }) {
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1.5", meta.badge)}>
      {Icon && <Icon className="h-3 w-3" />}
      {meta.label}
    </Badge>
  );
}

interface SortableCardProps {
  proj: Experience;
  index: number;
  isAdmin?: boolean;
  onDelete: (id: string) => void;
}

function SortableCard({ proj, index, isAdmin, onDelete }: SortableCardProps) {
  const router = useRouter();
  const [, startAssign] = useTransition();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: proj.id, disabled: !isAdmin });

  const style = {
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

  const meta = getTemplateMeta(proj.templateKey);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      // The whole card is the drag handle (admins only); the kebab is the only control.
      {...(isAdmin ? { ...attributes, ...listeners } : {})}
      className={cn(
        "group relative flex min-h-[168px] flex-col justify-between overflow-hidden p-5 transition-all duration-200 select-none",
        "hover:-translate-y-0.5 hover:shadow-md",
        isAdmin && "cursor-grab active:cursor-grabbing"
      )}
    >
      {/* Signature watermark index number, tinted to the template color */}
      <span
        className={cn(
          "pointer-events-none absolute -bottom-6 -right-2 select-none text-[110px] font-semibold leading-none tabular-nums",
          meta.number
        )}
      >
        {index + 1}
      </span>

      {/* Top row: template badge + actions */}
      <div className="relative flex items-start justify-between gap-2">
        <TemplateBadge meta={meta} />

        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Experience actions"
                // Don't let a click on the menu start a card drag.
                onPointerDown={(e) => e.stopPropagation()}
                className="-mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" onPointerDown={(e) => e.stopPropagation()}>
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
        )}
      </div>

      {/* Bottom: name + slug */}
      <div className="relative flex flex-col gap-1">
        <span className="text-sm font-medium uppercase tracking-wide text-foreground">
          {proj.name}
        </span>
        <span className="font-mono text-xs text-muted-foreground">/{proj.slug}</span>
      </div>
    </Card>
  );
}

export function ProjectsList({ projects, isAdmin = false }: ProjectsListProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [items, setItems] = useState<Experience[]>(projects);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  useEffect(() => {
    setItems(projects);
  }, [projects]);

  const handleClose = () => {
    setShowModal(false);
    router.refresh();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
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
        setItems(projects);
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
      {showModal && <CreateProjectModal onClose={handleClose} />}

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
        ) : (
          /* Uniform sortable grid */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((proj, index) => (
                  <SortableCard
                    key={proj.id}
                    proj={proj}
                    index={index}
                    isAdmin={isAdmin}
                    onDelete={handleDelete}
                  />
                ))}

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="group flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 p-6 text-muted-foreground transition-colors hover:border-border hover:bg-muted/50 hover:text-foreground"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-foreground">
                      <Plus className="h-4 w-4" />
                    </div>
                    <span className="text-xs font-medium">New Experience</span>
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
