import type { NextRequest } from "next/server";
import { crumbRedirect } from "@/lib/crumb-redirect";

/** Bare "Live" crumb on /experiences/<id>/live/<deviceId> — back to the experience. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ experienceId: string }> }
) {
  const { experienceId } = await params;
  return crumbRedirect(`/experiences/${encodeURIComponent(experienceId)}`);
}
