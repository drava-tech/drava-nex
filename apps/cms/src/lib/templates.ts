// Server-safe template metadata (no React imports), shared by the server action
// (validation) and the client-side template registry (definitions.ts). The keys
// live in @platform/types so the Hono API validates against the same source.

import { TEMPLATE_KEYS, type TemplateKey, isTemplateKey } from "@platform/types";

export { TEMPLATE_KEYS, isTemplateKey };
export type { TemplateKey };

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  portfolio: "Portfolio",
  "live-stream": "Live Stream",
  "product-showcase": "Product Showcase",
  welcome: "Welcome",
  "object-recognition": "Object Recognition",
  "flight-simulation": "Flight Simulation",
  gallery: "Gallery",
};
