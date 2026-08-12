import { requireAdmin } from "@/lib/auth-helpers";
import { listVisitors } from "@platform/db";
import { VisitorsClient } from "./_components/visitors-client";

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

  const result = await listVisitors({ page, pageSize: PAGE_SIZE, search });

  return (
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
    />
  );
}
