function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value);
}

function isDirectNextDevHost(): boolean {
  if (typeof window === "undefined") return false;

  const { hostname, port } = window.location;
  return (
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    (port === "3000" || port === "3001")
  );
}

export function resolveBrowserWsUrl(wsUrl: string): string {
  if (isAbsoluteUrl(wsUrl)) return wsUrl;

  const path = wsUrl.startsWith("/") ? wsUrl : `/${wsUrl}`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  if (isDirectNextDevHost() && (path === "/ws" || path.startsWith("/ws/"))) {
    return `${protocol}//${window.location.hostname}:4000${path}`;
  }

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

  if (isDirectNextDevHost()) {
    return `${window.location.protocol}//${window.location.hostname}:4000${path}`;
  }

  if (!apiBaseUrl || apiBaseUrl === "/") return path;

  const base = apiBaseUrl.replace(/\/$/, "");
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}
