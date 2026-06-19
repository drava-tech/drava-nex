import type { Vertical, SubProject } from "@/types/projects";

export async function getVerticals(): Promise<Vertical[]> {
  return [];
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
