// Server-safe template metadata (no React imports), shared by the server action
// (validation) and the client-side template registry (definitions.ts).

export const TEMPLATE_KEYS = ["portfolio", "live-stream"] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  portfolio: "Portfolio",
  "live-stream": "Live Stream",
};

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && (TEMPLATE_KEYS as readonly string[]).includes(value);
}
