/**
 * In-memory latest-frame store for the CMS camera debug preview. One JPEG per
 * camera, overwritten on every CAMERA_SNAPSHOT event — not persisted, not the
 * detection/trigger path, purely a visual aid (see internal.ts, vision-snapshot.ts).
 */

const MAX_AGE_MS = 30_000;

interface Snapshot {
  buffer: Buffer;
  updatedAt: number;
}

const snapshots = new Map<string, Snapshot>();

export function setLatestSnapshot(cameraId: string, buffer: Buffer): void {
  snapshots.set(cameraId, { buffer, updatedAt: Date.now() });
}

export function getLatestSnapshot(cameraId: string): Snapshot | null {
  const snap = snapshots.get(cameraId);
  if (!snap || Date.now() - snap.updatedAt > MAX_AGE_MS) return null;
  return snap;
}
