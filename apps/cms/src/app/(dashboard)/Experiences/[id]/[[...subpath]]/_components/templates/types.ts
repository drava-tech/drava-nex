export interface ResolvedProject<TConfig = Record<string, unknown>> {
  slug: string;
  title: string;
  type: string;
  config: TConfig;
  verticalId: string;
  verticalTitle: string;
}

export interface TemplateProps<TConfig = Record<string, unknown>> {
  project: ResolvedProject<TConfig>;
  subpath: string[];
  onBack: () => void;
  onNotify: (message: string) => void;
}
