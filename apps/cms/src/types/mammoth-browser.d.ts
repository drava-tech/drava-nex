// mammoth ships no TypeScript types (checked: no .d.ts anywhere in the package,
// no @types/mammoth on the registry) — this declares just the browser-build
// API surface apps/cms/src/app/display/word actually uses.
declare module "mammoth/mammoth.browser" {
  export interface ConvertResult {
    value: string;
    messages: unknown[];
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertResult>;
}
