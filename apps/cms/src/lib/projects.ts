import type { Vertical, SubProject } from "@/types/projects";

// JSON import — swap this single file when moving to a DB
import rawData from "@/app/(dashboard)/projects/_components/projects-data.json";

export async function getVerticals(): Promise<Vertical[]> {
  return rawData as Vertical[];
}

export async function getVerticalById(id: string): Promise<Vertical | undefined> {
  return (await getVerticals()).find((v) => v.id === id);
}

export async function getProjectBySlug(
  slug: string
): Promise<{ project: SubProject; vertical: Vertical } | undefined> {
  for (const vertical of await getVerticals()) {
    const project = vertical.projects.find((p) => p.slug === slug);
    if (project) return { project, vertical };
  }
  return undefined;
}
