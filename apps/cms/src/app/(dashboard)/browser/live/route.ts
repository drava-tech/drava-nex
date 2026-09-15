import { crumbRedirect } from "@/lib/crumb-redirect";

/** Bare "Live" crumb on /browser/live/<deviceId> — no page of its own. */
export async function GET() {
  return crumbRedirect("/browser");
}
