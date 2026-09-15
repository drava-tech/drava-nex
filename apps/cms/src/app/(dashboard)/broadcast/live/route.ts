import { crumbRedirect } from "@/lib/crumb-redirect";

/** Bare "Live" crumb on /broadcast/live/<deviceId> — back to the board. */
export async function GET() {
  return crumbRedirect("/broadcast");
}
