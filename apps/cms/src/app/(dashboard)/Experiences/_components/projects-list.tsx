"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, GripVertical, Trash2, Pencil, Eye } from "lucide-react";
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
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@platform/ui";
import { CreateProjectModal } from "./create-project-modal";
import { reorderExperiences, deleteProject } from "@/actions/project-actions";
import type { Experience } from "@platform/db";

const ACTION_BTN =
  "p-1.5 rounded-lg bg-zinc-200/50 hover:bg-zinc-300/80 dark:bg-zinc-800/40 dark:hover:bg-zinc-700/60 border border-zinc-300/30 dark:border-zinc-700/30 text-zinc-600 dark:text-zinc-400 hover:scale-105 active:scale-95 transition-all duration-150";

interface ProjectsListProps {
  projects: Experience[];
  isAdmin?: boolean;
}

function getCardSpanClasses(index: number): string {
  if (index === 0) return "col-span-2 row-span-1 md:col-span-2 md:row-span-2";
  if ((index - 3) % 6 === 0) return "col-span-1 row-span-1 md:col-span-2 md:row-span-1";
  return "col-span-1 row-span-1 md:col-span-1 md:row-span-1";
}

interface SortableCardProps {
  proj: Experience;
  index: number;
  isLarge: boolean;
  spanClasses: string;
  isAdmin?: boolean;
  onDelete: (id: string) => void;
}

function SortableCard({ proj, index, isLarge, spanClasses, isAdmin, onDelete }: SortableCardProps) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: proj.id, disabled: !isAdmin });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => router.push(`/experiences/${proj.slug}`)}
      className={[
        spanClasses,
        "bg-[#d6d6d6] dark:bg-zinc-900",
        "rounded-2xl flex flex-col justify-start gap-3 cursor-pointer",
        "border border-zinc-300/40 dark:border-zinc-800/50",
        "relative overflow-hidden shadow-sm select-none",
        isLarge ? "p-8 pb-10" : "p-5 pb-7",
      ].join(" ")}
    >
      {/* Action Controls for Admin */}
      {isAdmin && (
        <div className="absolute top-4 right-4 flex items-center gap-1.5 z-20">
          <TooltipProvider delayDuration={200}>
            {proj.templateKey && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={`/edit/experiences/${proj.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={ACTION_BTN}
                    >
                      <Pencil className="h-4 w-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>Edit template content</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={`/preview/experiences/${proj.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={ACTION_BTN}
                    >
                      <Eye className="h-4 w-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>Open full preview in a new tab</TooltipContent>
                </Tooltip>
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="p-1.5 rounded-lg bg-zinc-200/50 hover:bg-red-500/10 hover:text-red-500 dark:bg-zinc-800/40 dark:hover:bg-red-950/30 dark:hover:text-red-400 border border-zinc-300/30 dark:border-zinc-700/30 text-zinc-600 dark:text-zinc-400 hover:scale-105 active:scale-95 transition-all duration-150"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(proj.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete experience</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  {...attributes}
                  {...listeners}
                  className="p-1.5 rounded-lg bg-zinc-200/50 hover:bg-zinc-300/80 dark:bg-zinc-800/40 dark:hover:bg-zinc-700/60 border border-zinc-300/30 dark:border-zinc-700/30 text-zinc-600 dark:text-zinc-400 cursor-grab active:cursor-grabbing hover:scale-105 active:scale-95 transition-all duration-150"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Drag to reorder</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      <span
        className={[
          "font-normal leading-[0.75] text-white dark:text-zinc-800/35",
          "select-none inline-block",
          isLarge ? "text-[140px] -mt-4 -ml-4" : "text-[80px] -mt-3 -ml-3",
        ].join(" ")}
      >
        {index + 1}
      </span>
      <span
        className={[
          "font-normal text-zinc-900 dark:text-zinc-100 leading-snug uppercase tracking-wide select-none",
          isLarge ? "text-[20px]" : "text-[15px]",
        ].join(" ")}
      >
        {proj.name}
      </span>
      <span className="text-[10px] text-zinc-500 dark:text-zinc-600 font-mono select-none -mt-1">
        /{proj.slug}
      </span>
      {isLarge && (
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full bg-white/5 dark:bg-white/[0.02] -mr-16 -mb-16 pointer-events-none" />
      )}
    </div>
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-[9px] font-bold text-zinc-500 tracking-[0.25em] uppercase">
              Experiences
            </p>
            {saving && (
              <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                Saving order...
              </span>
            )}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-300 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 text-[10px] font-bold uppercase tracking-wider transition-all duration-200"
              >
                <Plus className="h-3 w-3" />
                New Experience
              </button>
            </div>
          )}
        </div>

        {/* Empty state */}
        {projects.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center gap-4 p-12 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-center ${
              isAdmin ? "cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-700 group" : ""
            }`}
            onClick={() => {
              if (isAdmin) setShowModal(true);
            }}
          >
            {isAdmin && (
              <div className="h-10 w-10 rounded-2xl bg-zinc-200 group-hover:bg-zinc-300 dark:bg-zinc-900 dark:group-hover:bg-zinc-800 flex items-center justify-center transition-colors">
                <Plus className="h-5 w-5 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
              </div>
            )}
            <div>
              <p className="text-sm font-normal text-zinc-500 dark:text-zinc-400">No experiences yet</p>
              {isAdmin && (
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                  Click to create your first experience
                </p>
              )}
            </div>
          </div>
        ) : (
          /* Sortable Bento grid */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div
                className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full"
                style={{ gridAutoRows: "140px", gridAutoFlow: "dense" }}
              >
                {items.map((proj, index) => {
                  const isLarge = index === 0;
                  const spanClasses = getCardSpanClasses(index);

                  return (
                    <SortableCard
                      key={proj.id}
                      proj={proj}
                      index={index}
                      isLarge={isLarge}
                      spanClasses={spanClasses}
                      isAdmin={isAdmin}
                      onDelete={handleDelete}
                    />
                  );
                })}

                {isAdmin && (
                  <div
                    onClick={() => setShowModal(true)}
                    className="col-span-1 row-span-1 bg-zinc-200/60 hover:bg-zinc-200 dark:bg-zinc-900/50 dark:hover:bg-zinc-900 border border-dashed border-zinc-300 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-700 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-200 group"
                  >
                    <div className="h-8 w-8 rounded-xl bg-zinc-300 group-hover:bg-zinc-400 dark:bg-zinc-800 dark:group-hover:bg-zinc-700 flex items-center justify-center transition-colors">
                      <Plus className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300" />
                    </div>
                    <span className="text-[10px] font-bold text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400 uppercase tracking-wider transition-colors">
                      New Experience
                    </span>
                  </div>
                )}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  );
}
