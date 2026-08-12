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

  const row = await getScreenLiveRow(screenId);
  if (!row) notFound();

  const [experiences, content] = await Promise.all([getExperiences(), getScreenContent(screenId)]);

  return (
    <LiveScreenSurface
      screenId={screenId}
      screenName={row.screenName}
      initialBlanked={row.blanked}
      initialInteractionEnabled={row.interactionEnabled}
      initialShowTouchpad={content?.type === "html"}
      changeContent={{
        experiences,
        defaultMediaAssetId: row.defaultMediaAssetId,
        defaultMediaName: row.defaultMediaName,
      }}
    />
  );
}
