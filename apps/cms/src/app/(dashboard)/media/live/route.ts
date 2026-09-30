import { crumbRedirect } from "@/lib/crumb-redirect";

/**
 * Bare "Live" crumb on /media/live/<deviceId> — no page of its own.
 *
 * nginx gotcha: the prod/dev configs route `^~ /media/live/` to the CMS, but
 * that prefix does NOT match the slash-less "/media/live", which would fall
 * through to `^~ /media/` (uploaded files, served by the API) and 404 there.
 * An exact `location = /media/live` block was added alongside it so this
 * handler is reachable at all — see infra/nginx/default.conf.
 */
export async function GET() {
  return crumbRedirect("/media");
}
