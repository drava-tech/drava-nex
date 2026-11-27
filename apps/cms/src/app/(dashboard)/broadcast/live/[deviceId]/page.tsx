import { notFound } from "next/navigation";
import { getScreenLiveRow, getScreenContent } from "@platform/db";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getExperiences } from "@/actions/project-actions";
import { LiveScreenSurface } from "@/components/live-screen-surface";

interface PageProps {
  // deviceId = a screen's screenId, same convention as the other
  // .../live/[deviceId] routes (media, experiences, browser).
  params: Promise<{ deviceId: string }>;
  // Where Back returns: a long-press "View Display" on Media's screen bar
  // sets it. Unset (Our Story, or after a push) = Our Story.
  searchParams: Promise<{ from?: string }>;
}

/** Allowed Back targets only, never an arbitrary URL from the query string. */
function backHrefFor(from: string | undefined): string {
  return from === "media" ? "/media" : "/broadcast";
}

/**
 * Live control page landed on right after publishing from /broadcast — same
 * full-page surface as /screens/<screenId> (LiveScreenSurface), just kept
 * under the /broadcast route so the sidebar stays on "Broadcast" instead of
 * jumping over to "Screens".
 */
export default async function BroadcastLivePage({ params, searchParams }: PageProps) {
  await requireGuestOrAdmin();
  const { deviceId } = await params;
  const { from } = await searchParams;
  const backHref = backHrefFor(from);

  const row = await getScreenLiveRow(deviceId);
  if (!row) notFound();

  const [experiences, content] = await Promise.all([getExperiences(), getScreenContent(deviceId)]);

  return (
    <LiveScreenSurface
      screenId={deviceId}
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
      backHref={backHref}
    />
  );
}
