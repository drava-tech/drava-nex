import React from "react";
import { notFound } from "next/navigation";
import type { Experience } from "@platform/db";
import { isTemplateKey, TEMPLATE_LABELS } from "@/lib/templates";
import { TEMPLATE_DEFINITIONS } from "@/templates/definitions";

interface DevPreviewPageProps {
  params: Promise<{ template: string; subpath?: string[] }>;
}

/**
 * Full-screen, chrome-free preview of a template rendered with its built-in
 * DEFAULT_*_CONTENT — no auth check, no database query. Lets a template be
 * viewed/iterated on without a reachable Postgres connection. Dev-only: 404s
 * outside local development so it never ships as an unauthenticated route.
 */
export default async function DevPreviewPage({ params }: DevPreviewPageProps) {
  if (process.env.NODE_ENV === "production") notFound();

  const { template, subpath = [] } = await params;
  if (!isTemplateKey(template)) notFound();

  const mockExperience: Experience = {
    id: "dev-preview",
    name: `${TEMPLATE_LABELS[template]} (dev preview)`,
    slug: "dev-preview",
    position: 0,
    templateKey: template,
    templateContent: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const Layout = TEMPLATE_DEFINITIONS[template].Layout;
  return (
    <div className="w-screen h-screen bg-black overflow-hidden touch-none overscroll-none">
      <Layout experience={mockExperience} subpath={subpath} mode="preview" />
    </div>
  );
}
