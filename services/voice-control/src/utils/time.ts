/** Hour of day (0-23) in Indian Standard Time, regardless of the machine's timezone. */
export function istHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
}

/** "Good morning" (5-11), "Good afternoon" (12-16), otherwise "Good evening" — by IST. */
export function timeOfDayGreeting(now: Date = new Date()): string {
  const h = istHour(now);
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}
