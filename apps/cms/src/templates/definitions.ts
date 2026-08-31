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
import { ObjectRecognitionLayout } from "./object-recognition/object-recognition-layout";
import { FlightSimulationLayout } from "./flight-simulation/flight-simulation-layout";
import { FlightSimulationEditorWorkspace } from "./flight-simulation/editor-workspace";
import { GalleryLayout } from "./gallery/gallery-layout";
import { GalleryEditorWorkspace } from "./gallery/editor-workspace";
import { DEFAULT_PORTFOLIO_CONTENT } from "@platform/ui/templates/portfolio";
import { DEFAULT_LIVE_STREAM_CONTENT } from "@platform/ui/templates/live-stream";
import { DEFAULT_PRODUCT_SHOWCASE_CONTENT } from "@platform/ui/templates/product-showcase";
import { DEFAULT_WELCOME_CONTENT } from "@platform/ui/templates/welcome";
import { DEFAULT_OBJECT_RECOGNITION_CONTENT } from "@platform/ui/templates/object-recognition";
import { DEFAULT_FLIGHT_SIMULATION_CONTENT } from "@platform/ui/templates/flight-simulation";
import { DEFAULT_GALLERY_CONTENT } from "@platform/ui/templates/gallery";

/**
 * A code-defined template: its key, a human label, and the Layout that renders an
 * experience assigned to this template. Adding a template = one entry here
 * (and its key in @/lib/templates).
 */
export interface TemplateDefinition {
  key: TemplateKey;
  label: string;
  // A plain function type (not React.ComponentType) so an async Server
  // Component — PortfolioLayout fetches its relational tree from the DB —
  // is assignable alongside the other templates' synchronous Layouts.
  Layout: (props: {
    experience: Experience;
    subpath: string[];
    mode?: "edit" | "preview";
  }) => React.ReactNode | Promise<React.ReactNode>;
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
  "object-recognition": {
    key: "object-recognition",
    label: TEMPLATE_LABELS["object-recognition"],
    Layout: ObjectRecognitionLayout,
    defaultContent: DEFAULT_OBJECT_RECOGNITION_CONTENT,
    // No Workspace — nothing is authored here, content is pushed live by the
    // mat camera (see apps/api/src/ws/gateway.ts's applyMatInventoryUpdate).
  },
  "flight-simulation": {
    key: "flight-simulation",
    label: TEMPLATE_LABELS["flight-simulation"],
    Layout: FlightSimulationLayout,
    defaultContent: DEFAULT_FLIGHT_SIMULATION_CONTENT,
    Workspace: FlightSimulationEditorWorkspace,
  },
  gallery: {
    key: "gallery",
    label: TEMPLATE_LABELS.gallery,
    Layout: GalleryLayout,
    defaultContent: DEFAULT_GALLERY_CONTENT,
    Workspace: GalleryEditorWorkspace,
  },
};

export const TEMPLATE_OPTIONS: TemplateDefinition[] = Object.values(TEMPLATE_DEFINITIONS);
