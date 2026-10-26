/**
 * Integration tests may only ever talk to the LOCAL Docker Postgres. This is the
 * single gate: every URL they use goes through here first, and anything else —
 * the production server, any other host, the wrong port, a database that isn't
 * the local dev one or a throwaway test one — is refused before a connection is
 * even attempted.
 */

export interface LocalDbTarget {
  url: string;
  host: string;
  port: string;
  database: string;
}

/** The only hosts that count as "this machine". */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Published port of platform-postgres (infra/docker/docker-compose.local.yml). */
export const LOCAL_DB_PORT = "5433";
export const LOCAL_DEV_DATABASE = "cms_db_local";
export const THROWAWAY_DB_PREFIX = "cms_it_";

export function assertLocalDatabaseUrl(raw: string | undefined, label = "the integration database URL"): LocalDbTarget {
  if (!raw || !raw.trim()) {
    throw new Error(
      `Integration tests refuse to run: ${label} is not set. Set IT_DATABASE_URL explicitly ` +
        `(never read from .env), e.g. postgresql://cms_dev:<password>@localhost:5433/cms_db_local`
    );
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Integration tests refuse to run: ${label} is not a valid URL.`);
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) {
    throw new Error(`Integration tests refuse to run: ${label} is not a postgres URL (${u.protocol}).`);
  }
  const host = u.hostname.toLowerCase();
  const port = u.port || "5432";
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Integration tests refuse to run: host "${host}" is not localhost. They only ever use the local Docker database.`);
  }
  if (port !== LOCAL_DB_PORT) {
    throw new Error(`Integration tests refuse to run: port ${port} is not the local Docker Postgres port ${LOCAL_DB_PORT}.`);
  }
  if (database !== LOCAL_DEV_DATABASE && database !== "postgres" && !database.startsWith(THROWAWAY_DB_PREFIX)) {
    throw new Error(
      `Integration tests refuse to run: database "${database}" is not ${LOCAL_DEV_DATABASE} or a ${THROWAWAY_DB_PREFIX}* throwaway.`
    );
  }
  return { url: raw, host, port, database };
}

/** Same URL, different database name (credentials and host untouched). */
export function withDatabase(raw: string, database: string): string {
  const u = new URL(raw);
  u.pathname = `/${database}`;
  return u.toString();
}
