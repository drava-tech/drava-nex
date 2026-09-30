import { NextResponse } from "next/server";

/**
 * Liveness probe for THIS container (see the `cms` healthcheck in
 * infra/docker/docker-compose.yml).
 *
 * Not served at "/health": that path is listed in next.config.mjs's
 * `beforeFiles` rewrites, which take precedence over filesystem routes, so a
 * route file there would never be reached and the probe would silently be
 * testing the API instead — letting a wedged CMS container keep looking
 * healthy. Hence the distinct path.
 *
 * Does no database or upstream work on purpose: it answers only the question
 * the orchestrator is asking, "is this Next server still serving requests?"
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", service: "cms" });
}
