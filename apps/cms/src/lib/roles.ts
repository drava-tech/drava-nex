/**
 * Who can do what in Nex. The database roles are SUPERADMIN, ADMIN and GUEST;
 * GUEST is shown as "User" — someone who operates Nex day to day.
 */
export type UserRole = "SUPERADMIN" | "ADMIN" | "GUEST";

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPERADMIN: "Super admin",
  ADMIN: "Admin",
  GUEST: "User",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPERADMIN: "Everything, including adding and removing people.",
  ADMIN: "Everything except managing who can sign in: settings, screens, media, schedules, environment.",
  GUEST: "Uses Nex day to day: the dashboard, Our Story and screens — pushing content and controlling them. Can't change settings, add screens, or manage media, schedules or people.",
};

export function roleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[(role ?? "GUEST") as UserRole] ?? role ?? "User";
}
