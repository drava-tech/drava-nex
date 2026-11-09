import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { getScreens } from "@/actions/screen-actions";
import { getScreenGroups } from "@/actions/screen-group-actions";
import { getExperiences } from "@/actions/project-actions";
import { getSchedules, getScheduleStatus } from "@/actions/schedule-actions";
import { getMotionOverview } from "@/actions/motion-trigger-actions";
import { SchedulesView } from "./_components/schedules-view";

/**
 * Scheduling: playlists of experiences and media that run on chosen screens
 * and groups inside a time window. The API's scheduler runs them; this page
 * creates and edits them and shows what is on air now and over the week.
 */
export default async function SchedulesPage() {
  const user = await requireGuestOrAdmin();
  const [schedules, screens, groups, experiences, status] = await Promise.all([
    getSchedules(),
    getScreens(),
    getScreenGroups(),
    getExperiences(),
    getScheduleStatus(),
  ]);
  const role = (user as { role?: string }).role;
  const isAdmin = role === "ADMIN" || role === "SUPERADMIN";
  // Motion triggers are an admin tool; never let them stop the page loading.
  const motion = isAdmin ? await getMotionOverview().catch(() => null) : null;

  return (
    <SchedulesView
      schedules={schedules}
      screens={screens.map((s) => ({ screenId: s.screenId, screenName: s.screenName, groupId: s.groupId ?? null }))}
      groups={groups}
      experiences={experiences.map((e) => ({ id: e.id, title: e.title, coverImage: e.coverImage }))}
      initialStatus={status}
      motion={motion}
      isAdmin={isAdmin}
    />
  );
}
