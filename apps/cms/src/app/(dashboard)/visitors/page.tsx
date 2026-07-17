import { requireAdmin } from "@/lib/auth-helpers";
import { listVisitors } from "@platform/db";
import { getVisionTriggerArmed } from "@/actions/vision-actions";
import { VisitorsClient } from "./visitors-client";

const PAGE_SIZE = 20;

export default async function VisitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  await requireAdmin();

  const { page: pageParam, search: searchParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const search = (searchParam ?? "").trim() || undefined;

  const [result, triggerArmed] = await Promise.all([
    listVisitors({ page, pageSize: PAGE_SIZE, search }),
    getVisionTriggerArmed(),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Visitors</h1>
        <p className="text-sm text-muted-foreground">
          People recognized at the entrance camera. New visitors are enrolled
          anonymously — assign a name once you know who they are.
        </p>
      </div>
      <VisitorsClient
        visitors={result.items.map((v) => ({
          uuid: v.uuid,
          name: v.name,
          email: v.email,
          role: v.role,
          hasImage: v.imagePath !== null,
          firstSeen: v.firstSeen.toISOString(),
          lastSeen: v.lastSeen.toISOString(),
        }))}
        total={result.total}
        page={page}
        pageSize={PAGE_SIZE}
        search={search ?? ""}
        initialTriggerArmed={triggerArmed}
      />
    </div>
  );
}
