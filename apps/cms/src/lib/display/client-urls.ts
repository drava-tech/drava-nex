// Single-origin model: the browser always talks to one host (nginx routes /api
// and /ws to the API). URLs are same-origin relative unless an env var provides
// an absolute override — no hostname/port sniffing.

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value);
}

export function resolveBrowserWsUrl(wsUrl: string): string {
  if (isAbsoluteUrl(wsUrl)) return wsUrl;

  const path = wsUrl.startsWith("/") ? wsUrl : `/${wsUrl}`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function resolveBrowserApiEndpoint(apiBaseUrl: string, apiPath: string): string {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;

  if (isAbsoluteUrl(apiBaseUrl)) {
    const base = apiBaseUrl.replace(/\/$/, "");
    if (base.endsWith("/api") && path.startsWith("/api/")) {
      return `${base}${path.slice("/api".length)}`;
    }
    return `${base}${path}`;
  }

  // Same-origin: use the relative path as-is (nginx routes /api to the API).
  if (!apiBaseUrl || apiBaseUrl === "/") return path;

  const base = apiBaseUrl.replace(/\/$/, "");
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}
