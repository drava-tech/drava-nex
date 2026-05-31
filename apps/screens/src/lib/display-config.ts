import type {
  ScreensConfig,
  ContentsConfig,
  DisplayConfig,
  Screen,
  Content,
} from "@/types/display";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads a JSON file from /public/config at BUILD/RUN TIME (server-side only).
 * Uses Node `fs` — safe in Next.js App Router Server Components & generateStaticParams.
 */
async function readPublicJson<T>(filename: string): Promise<T> {
  const { readFile } = await import("fs/promises");
  const { join } = await import("path");

  // process.cwd() points to apps/screens at runtime
  const filePath = join(process.cwd(), "public", "config", filename);

  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new Error(
      `[display-config] Failed to load "${filename}": ${String(cause)}`
    );
  }
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

export async function loadScreens(): Promise<Screen[]> {
  const config = await readPublicJson<ScreensConfig>("screens.json");

  if (!Array.isArray(config.screens)) {
    throw new Error("[display-config] screens.json: 'screens' must be an array");
  }

  return config.screens;
}

export async function loadContents(): Promise<Content[]> {
  const config = await readPublicJson<ContentsConfig>("contents.json");

  if (!Array.isArray(config.contents)) {
    throw new Error("[display-config] contents.json: 'contents' must be an array");
  }

  return config.contents;
}

// ─── Resolver ────────────────────────────────────────────────────────────────

export async function resolveDisplayConfig(
  screenId: string
): Promise<DisplayConfig> {
  const [screens, contents] = await Promise.all([
    loadScreens(),
    loadContents(),
  ]);

  const screen = screens.find((s) => s.screenId === screenId);
  if (!screen) {
    throw new DisplayConfigError(
      `Screen "${screenId}" not found. Valid IDs: ${screens.map((s) => s.screenId).join(", ")}`,
      "SCREEN_NOT_FOUND"
    );
  }

  const content = contents.find((c) => c.id === screen.contentId);
  if (!content) {
    throw new DisplayConfigError(
      `Content "${screen.contentId}" assigned to screen "${screenId}" was not found in contents.json`,
      "CONTENT_NOT_FOUND"
    );
  }

  return { screen, content };
}

// ─── Custom Error ─────────────────────────────────────────────────────────────

export type DisplayErrorCode =
  | "SCREEN_NOT_FOUND"
  | "CONTENT_NOT_FOUND"
  | "INVALID_CONFIG";

export class DisplayConfigError extends Error {
  constructor(
    message: string,
    public readonly code: DisplayErrorCode
  ) {
    super(message);
    this.name = "DisplayConfigError";
  }
}
