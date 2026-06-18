export interface PanelItem {
  id: string;
  label: string;
}

export interface Panel {
  id: string;
  title: string;
  items: PanelItem[];
}

export interface ConsolePanelsConfig {
  panels: Panel[];
}

export interface SubProject {
  id: number;
  slug: string;
  title: string;
  type?: string;
  config?: Record<string, unknown>;
}

export interface Vertical {
  id: string;
  title: string;
  type?: string;
  config?: Record<string, unknown>;
  videoUrl: string;
  thumbnailUrl: string;
  projects: SubProject[];
}
