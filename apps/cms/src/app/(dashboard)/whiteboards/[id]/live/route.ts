import type { NextRequest } from "next/server";
import { crumbRedirect } from "@/lib/crumb-redirect";

/**
 * /whiteboards/<id>/live has no page of its own. The breadcrumb never links
 * here (it collapses the live segments back to the board — see
 * dashboard-breadcrumb.tsx), but a typed or bookmarked URL would still 404.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return crumbRedirect(`/whiteboards/${encodeURIComponent(id)}`);
}
