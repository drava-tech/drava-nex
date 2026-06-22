import type React from "react";
import type { Experience } from "@platform/db";
import { TEMPLATE_LABELS, type TemplateKey } from "@/lib/templates";
import { PortfolioLayout } from "./portfolio/portfolio-layout";
import { PortfolioEditorWorkspace } from "./portfolio/editor-workspace";
import { DEFAULT_PORTFOLIO_CONTENT } from "./portfolio/content";

/**
 * A code-defined template: its key, a human label, and the Layout that renders an
 * experience assigned to this template. Adding a template = one entry here
 * (and its key in @/lib/templates).
 */
export interface TemplateDefinition {
  key: TemplateKey;
  label: string;
  Layout: React.ComponentType<{
    experience: Experience;
    subpath: string[];
    mode?: "edit" | "preview";
  }>;
  defaultContent?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Workspace?: React.ComponentType<{ experience: Experience; initialContent: any }>;
}

export const TEMPLATE_DEFINITIONS: Record<TemplateKey, TemplateDefinition> = {
  portfolio: {
    key: "portfolio",
    label: TEMPLATE_LABELS.portfolio,
    Layout: PortfolioLayout,
    defaultContent: DEFAULT_PORTFOLIO_CONTENT,
    Workspace: PortfolioEditorWorkspace,
  },
};

export const TEMPLATE_OPTIONS: TemplateDefinition[] = Object.values(TEMPLATE_DEFINITIONS);
