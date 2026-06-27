/**
 * Parses the CAMERA_SCREEN_MAP environment variable.
 * Format: camera-01:main-screen,camera-02:lobby
 */
let cameraMapCache: Map<string, string> | null = null;

function getCameraMap(): Map<string, string> {
  if (cameraMapCache) {
    return cameraMapCache;
  }

  const map = new Map<string, string>();
  const envMap = process.env.CAMERA_SCREEN_MAP;
  
  if (envMap) {
    const pairs = envMap.split(",");
    for (const pair of pairs) {
      const [cameraId, screenId] = pair.split(":");
      if (cameraId && screenId) {
        map.set(cameraId.trim(), screenId.trim());
      }
    }
  }

  cameraMapCache = map;
  return map;
}

/**
 * Returns the screenId mapped to a given cameraId, or null if unmapped.
 */
export function getCameraScreen(cameraId: string): string | null {
  return getCameraMap().get(cameraId) || null;
}
