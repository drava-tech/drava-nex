import { notFound } from "next/navigation";
import { getScreenLiveRow, getScreenContent } from "@platform/db";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getExperiences } from "@/actions/project-actions";
import { LiveScreenSurface } from "@/components/live-screen-surface";

interface PageProps {
  params: Promise<{ screenId: string }>;
}

/**
 * Full-page in-CMS control surface for a single screen, served at
 * /screens/<screenId> (Dashboard / Screens / <screen>). Shows the live,
 * interactive screen — touch/explore here and it is mirrored on the TV in
 * realtime — plus a content picker. The public TV display lives at /display/<id>.
 */
export default async function ScreenControlPage({ params }: PageProps) {
  await requireGuestOrAdmin();
  const { screenId } = await params;

  // All three are independent — the not-found check only needs `row` to have
  // settled, not to have gated the other two. Awaiting it first cost a full
  // serial DB round trip of dead wall-clock time on every open of this page.
  const [row, experiences, content] = await Promise.all([
    getScreenLiveRow(screenId),
    getExperiences(),
    getScreenContent(screenId),
  ]);
  if (!row) notFound();

  return (
    <LiveScreenSurface
      screenId={screenId}
      screenName={row.screenName}
      initialBlanked={row.blanked}
      initialShowTouchpad={content?.type === "html"}
      changeContent={{
        experiences,
        defaultMediaAssetId: row.defaultMediaAssetId,
        defaultMediaName: row.defaultMediaName,
      }}
      initialContent={
        content
          ? {
              id: content.id,
              type: content.type,
              source: content.source,
              templateKey: content.templateKey,
              experienceId: content.type === "experience" ? content.id : undefined,
              templateContent: content.templateContent,
            }
          : null
      }
      backHref="/screens"
    />
  );
}
