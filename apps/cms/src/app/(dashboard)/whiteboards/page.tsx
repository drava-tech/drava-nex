import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { listWhiteboards } from "@/actions/whiteboard-actions";
import { WhiteboardsList } from "./_components/whiteboards-list";

export default async function WhiteboardsPage() {
  await requireGuestOrAdmin();
  const documents = await listWhiteboards();

  const items = documents.map((d) => ({
    id: d.id,
    name: d.name,
    pageCount: Array.isArray(d.pages) ? d.pages.length : 0,
    updatedAt: d.updatedAt.toISOString(),
  }));

  return (
    <div className="flex flex-col p-4 bg-zinc-100 dark:bg-black h-[calc(100vh-5rem)] min-h-0 overflow-hidden">
      <WhiteboardsList items={items} />
    </div>
  );
}
