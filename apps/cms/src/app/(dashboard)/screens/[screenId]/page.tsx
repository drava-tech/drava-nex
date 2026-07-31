import { notFound } from "next/navigation";
import { db, screen, mediaAsset, eq, and, isNull, getScreenContent } from "@platform/db";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getExperiences } from "@/actions/project-actions";
import { ScreenControlView } from "@/app/(dashboard)/screens/_components/screen-control-view";

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

  const [row] = await db
    .select({
      screenName: screen.screenName,
      defaultMediaAssetId: screen.defaultMediaAssetId,
      defaultMediaName: mediaAsset.name,
      blanked: screen.blanked,
      interactionEnabled: screen.interactionEnabled,
    })
    .from(screen)
    .leftJoin(
      mediaAsset,
      and(eq(screen.defaultMediaAssetId, mediaAsset.id), isNull(mediaAsset.deletedAt))
    )
    .where(and(eq(screen.screenId, screenId), isNull(screen.deletedAt)))
    .limit(1);

  if (!row) notFound();

  const [experiences, content] = await Promise.all([getExperiences(), getScreenContent(screenId)]);
  const initialShowTouchpad = content?.type === "webpage" || content?.type === "html";

  return (
    <ScreenControlView
      screenId={screenId}
      screenName={row.screenName}
      experiences={experiences}
      defaultMediaAssetId={row.defaultMediaAssetId}
      defaultMediaName={row.defaultMediaName}
      initialBlanked={row.blanked}
      initialInteractionEnabled={row.interactionEnabled}
      initialShowTouchpad={initialShowTouchpad}
    />
  );
}
