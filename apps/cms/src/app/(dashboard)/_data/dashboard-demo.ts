// Static demo data powering the dashboard home page.
// Names mirror the real seed data (experiences + screens) so the dashboard
// reads as a believable snapshot of the signage network.

export interface ActivityItem {
  id: string;
  user: string;
  initials: string;
  action: string;
  target: string;
  time: string;
  kind: "screen" | "experience" | "media" | "user";
}

export interface DeltaStat {
  label: string;
  value: string;
  delta: number; // percentage change vs. previous week
  breakdown: string;
}

// --- KPI cards -------------------------------------------------------------

export const stats = {
  screens: {
    label: "Total Screens",
    value: "6",
    delta: 12.5,
    breakdown: "4 online · 1 offline · 1 maintenance",
  },
  experiences: {
    label: "Experiences",
    value: "5",
    delta: 8.0,
    breakdown: "3 portfolio · 2 live-stream",
  },
  users: {
    label: "Active Users",
    value: "4",
    delta: -3.2,
    breakdown: "1 admin · 3 guests",
  },
} satisfies Record<string, DeltaStat>;

// --- Screen uptime, last 7 days (% of screens online) ----------------------

export const uptimeSeries: { day: string; value: number }[] = [
  { day: "Mon", value: 82 },
  { day: "Tue", value: 74 },
  { day: "Wed", value: 91 },
  { day: "Thu", value: 86 },
  { day: "Fri", value: 95 },
  { day: "Sat", value: 78 },
  { day: "Sun", value: 88 },
];
// --- Recent activity feed --------------------------------------------------

export const activity: ActivityItem[] = [
  {
    id: "a1",
    user: "Vamsi",
    initials: "VA",
    action: "assigned",
    target: "Experience Center → tv-86inch",
    time: "5m ago",
    kind: "screen",
  },
  {
    id: "a2",
    user: "Priya",
    initials: "PR",
    action: "uploaded",
    target: "Promo Reel.mp4",
    time: "32m ago",
    kind: "media",
  },
  {
    id: "a3",
    user: "Vamsi",
    initials: "VA",
    action: "published",
    target: "Event Stream (live-stream)",
    time: "1h ago",
    kind: "experience",
  },
  {
    id: "a4",
    user: "Arjun",
    initials: "AR",
    action: "edited",
    target: "Architecture & Interiors",
    time: "2h ago",
    kind: "experience",
  },
  {
    id: "a5",
    user: "Vamsi",
    initials: "VA",
    action: "invited",
    target: "kiran@thewhitetusker.com",
    time: "Yesterday",
    kind: "user",
  },
];
