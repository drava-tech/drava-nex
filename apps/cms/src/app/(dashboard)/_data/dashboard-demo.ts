// Static demo data powering the dashboard home page.
// Names mirror the real seed data (experiences + screens) so the dashboard
// reads as a believable snapshot of the signage network.

export type ScreenStatus = "online" | "offline" | "maintenance";
export type ContentKind = "portfolio" | "live-stream" | "media" | "none";
export type MediaType = "image" | "video" | "document";

export interface DemoScreen {
  id: string;
  name: string;
  location: string;
  status: ScreenStatus;
  content: string;
  contentKind: ContentKind;
  lastSeen: string;
}

export interface ActivityItem {
  id: string;
  user: string;
  initials: string;
  action: string;
  target: string;
  time: string;
  kind: "screen" | "experience" | "media" | "user";
}

export interface RecentUpload {
  id: string;
  name: string;
  type: MediaType;
  size: string;
  time: string;
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
  media: {
    label: "Media Assets",
    value: "8",
    delta: 25.0,
    breakdown: "1.4 GB total",
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

// --- Visitor flow (hourly footfall, today) ---------------------------------

export const visitorFlow: { label: string; value: number }[] = [
  { label: "09:30", value: 14 },
  { label: "10:30", value: 20 },
  { label: "11:30", value: 27 },
  { label: "12:30", value: 23 },
  { label: "13:30", value: 41 },
  { label: "14:30", value: 33 },
  { label: "15:30", value: 47 },
  { label: "16:30", value: 36 },
  { label: "17:30", value: 82 },
];

// --- AI recognition confidence ---------------------------------------------

export const recognitionMetrics: { label: string; value: number }[] = [
  { label: "Face Detection", value: 98.7 },
  { label: "Emotion Sensing", value: 94.2 },
  { label: "Crowd Density", value: 99.1 },
];

// --- Live displays ---------------------------------------------------------

export const displays: {
  name: string;
  content: string;
  live: boolean;
  time: string;
}[] = [
  { name: '85"', content: "Presentation", live: true, time: "01:30" },
  { name: '24"', content: "Immersive Home", live: true, time: "00:42" },
  { name: "Outdoor", content: "WT Logo reveal", live: true, time: "02:15" },
  { name: "Lobby", content: "standby mode", live: false, time: "04:12" },
];

// --- Content mix (donut) ---------------------------------------------------

export const contentMix: { label: string; value: number; colorVar: string }[] = [
  { label: "Portfolio", value: 3, colorVar: "var(--chart-1)" },
  { label: "Live-stream", value: 2, colorVar: "var(--chart-2)" },
  { label: "Media", value: 1, colorVar: "var(--chart-3)" },
];

// --- Screens table ---------------------------------------------------------

export const screens: DemoScreen[] = [
  {
    id: "main-screen",
    name: "tv-86inch",
    location: "Main Lobby",
    status: "online",
    content: "Experience Center",
    contentKind: "portfolio",
    lastSeen: "Just now",
  },
  {
    id: "reception-01",
    name: "Reception Display",
    location: "Front Desk",
    status: "online",
    content: "Architecture & Interiors",
    contentKind: "portfolio",
    lastSeen: "2 min ago",
  },
  {
    id: "lobby-live",
    name: "Lobby Live Feed",
    location: "Atrium",
    status: "online",
    content: "Event Stream",
    contentKind: "live-stream",
    lastSeen: "Just now",
  },
  {
    id: "conf-a",
    name: "Conference Room A",
    location: "2nd Floor",
    status: "online",
    content: "Brand Solutions",
    contentKind: "portfolio",
    lastSeen: "1 min ago",
  },
  {
    id: "screen-2",
    name: "tv-2",
    location: "Break Room",
    status: "maintenance",
    content: "Promo Reel.mp4",
    contentKind: "media",
    lastSeen: "3 hr ago",
  },
  {
    id: "garage-01",
    name: "Parking Display",
    location: "Garage Entry",
    status: "offline",
    content: "Unassigned",
    contentKind: "none",
    lastSeen: "1 day ago",
  },
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

// --- Storage usage by media type -------------------------------------------

export const storageByType: { label: string; gb: number; colorVar: string }[] = [
  { label: "Video", gb: 0.92, colorVar: "var(--chart-1)" },
  { label: "Images", gb: 0.38, colorVar: "var(--chart-2)" },
  { label: "Documents", gb: 0.1, colorVar: "var(--chart-3)" },
];

export const storageTotalGb = 5;

export const recentUploads: RecentUpload[] = [
  { id: "m1", name: "Promo Reel.mp4", type: "video", size: "420 MB", time: "32m ago" },
  { id: "m2", name: "Lobby Backdrop.jpg", type: "image", size: "8.2 MB", time: "3h ago" },
  { id: "m3", name: "Brand Guidelines.pdf", type: "document", size: "2.1 MB", time: "Yesterday" },
  { id: "m4", name: "Atrium Loop.mp4", type: "video", size: "510 MB", time: "2 days ago" },
];
