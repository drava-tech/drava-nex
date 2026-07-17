import type React from "react";
import type { Experience } from "@platform/db";
import { TEMPLATE_LABELS, type TemplateKey } from "@/lib/templates";
import { PortfolioLayout } from "./portfolio/portfolio-layout";
import { PortfolioEditorWorkspace } from "./portfolio/editor-workspace";
import { LiveStreamLayout } from "./live-stream/live-stream-layout";
import { LiveStreamEditorWorkspace } from "./live-stream/editor-workspace";
import { ProductShowcaseLayout } from "./product-showcase/product-showcase-layout";
import { ProductShowcaseEditorWorkspace } from "./product-showcase/editor-workspace";
import { WelcomeLayout } from "./welcome/welcome-layout";
import { WelcomeEditorWorkspace } from "./welcome/editor-workspace";
import { DEFAULT_PORTFOLIO_CONTENT } from "@platform/ui/templates/portfolio";
import { DEFAULT_LIVE_STREAM_CONTENT } from "@platform/ui/templates/live-stream";
import { DEFAULT_PRODUCT_SHOWCASE_CONTENT } from "@platform/ui/templates/product-showcase";
import { DEFAULT_WELCOME_CONTENT } from "@platform/ui/templates/welcome";

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
  "live-stream": {
    key: "live-stream",
    label: TEMPLATE_LABELS["live-stream"],
    Layout: LiveStreamLayout,
    defaultContent: DEFAULT_LIVE_STREAM_CONTENT,
    Workspace: LiveStreamEditorWorkspace,
  },
  "product-showcase": {
    key: "product-showcase",
    label: TEMPLATE_LABELS["product-showcase"],
    Layout: ProductShowcaseLayout,
    defaultContent: DEFAULT_PRODUCT_SHOWCASE_CONTENT,
    Workspace: ProductShowcaseEditorWorkspace,
  },
  welcome: {
    key: "welcome",
    label: TEMPLATE_LABELS.welcome,
    Layout: WelcomeLayout,
    defaultContent: DEFAULT_WELCOME_CONTENT,
    Workspace: WelcomeEditorWorkspace,
  },
};

export const TEMPLATE_OPTIONS: TemplateDefinition[] = Object.values(TEMPLATE_DEFINITIONS);
