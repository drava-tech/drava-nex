import type React from "react";
import type { TemplateProps } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTemplateComponent = React.ComponentType<TemplateProps<any>>;

const registry = new Map<string, AnyTemplateComponent>();

export function registerTemplate(type: string, component: AnyTemplateComponent): void {
  if (process.env.NODE_ENV === "development" && registry.has(type)) {
    console.warn(`[TemplateRegistry] Overwriting existing template for type: "${type}"`);
  }
  registry.set(type, component);
}

export function getTemplate(type: string): AnyTemplateComponent | undefined {
  return registry.get(type);
}
