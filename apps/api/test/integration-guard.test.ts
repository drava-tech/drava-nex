import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, withDatabase } from "./integration/guard.js";

const ok = (url: string) => assertLocalDatabaseUrl(url);
const refused = (url: string | undefined, pattern: RegExp) => expect(() => assertLocalDatabaseUrl(url)).toThrow(pattern);

describe("the integration suite's localhost guard", () => {
  it("accepts the local Docker database and its throwaway databases", () => {
    expect(ok("postgresql://cms_dev:pw@localhost:5433/cms_db_local")).toMatchObject({ host: "localhost", port: "5433", database: "cms_db_local" });
    expect(ok("postgres://u:p@127.0.0.1:5433/cms_it_1234_abcdef").database).toBe("cms_it_1234_abcdef");
    expect(ok("postgresql://u:p@[::1]:5433/postgres").database).toBe("postgres");
  });

  it("refuses the production server, however it is spelled", () => {
    refused("postgresql://cms_app:pw@192.168.1.250:5432/cms_db", /not localhost/);
    refused("postgresql://cms_app:pw@192.168.1.250:5433/cms_db_local", /not localhost/);
    refused("postgresql://cms_app:pw@cms-server.lan:5433/cms_db_local", /not localhost/);
    refused("postgresql://cms_app:pw@postgres:5432/cms_db", /not localhost/); // the Docker service name
  });

  it("refuses a look-alike host", () => {
    refused("postgresql://u:p@localhost.evil.example:5433/cms_db_local", /not localhost/);
    refused("postgresql://u:p@127.0.0.1.nip.io:5433/cms_db_local", /not localhost/);
    refused("postgresql://u:p@0.0.0.0:5433/cms_db_local", /not localhost/);
  });

  it("refuses localhost on the wrong port (a tunnel to somewhere else, a different local Postgres)", () => {
    refused("postgresql://u:p@localhost:5432/cms_db_local", /port 5432/);
    refused("postgresql://u:p@localhost/cms_db_local", /port 5432/); // default port
  });

  it("refuses a database that is neither the local dev one nor a throwaway", () => {
    refused("postgresql://u:p@localhost:5433/cms_db", /not cms_db_local/);
    refused("postgresql://u:p@localhost:5433/prod", /not cms_db_local/);
  });

  it("refuses a missing, empty, malformed or non-postgres URL", () => {
    refused(undefined, /not set/);
    refused("", /not set/);
    refused("   ", /not set/);
    refused("not a url", /not a valid URL/);
    refused("http://localhost:5433/cms_db_local", /not a postgres URL/);
  });

  it("withDatabase swaps only the database name", () => {
    expect(withDatabase("postgresql://u:p@localhost:5433/cms_db_local", "cms_it_x")).toBe("postgresql://u:p@localhost:5433/cms_it_x");
  });
});
