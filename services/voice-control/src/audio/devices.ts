/**
 * Pick an audio device by name preference. Windows device names are long
 * ("Headset (Smiledrive Hands-Free AG Audio)"), so preferences are
 * case-insensitive substrings, tried in order. -1 = the system default
 * device (PvRecorder / PvSpeaker convention).
 */
export function pickDevice(available: string[], preferences: string[]): { index: number; name: string } {
  for (const pref of preferences) {
    const p = pref.toLowerCase();
    const index = available.findIndex((d) => d.toLowerCase().includes(p));
    if (index >= 0) return { index, name: available[index]! };
  }
  return { index: -1, name: "(system default)" };
}
