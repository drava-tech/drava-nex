/**
 * The display's own identity, kept in this browser only. A display never signs
 * in; it holds the device token it received when it was paired.
 */
export type DeviceCredentials = { screenId: string; name: string; token: string }

const KEY = "push.device"

export function readDevice(): DeviceCredentials | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<DeviceCredentials>
    return v.screenId && v.token ? { screenId: v.screenId, name: v.name ?? "", token: v.token } : null
  } catch {
    return null
  }
}

export function saveDevice(creds: DeviceCredentials) {
  localStorage.setItem(KEY, JSON.stringify(creds))
}

export function forgetDevice() {
  localStorage.removeItem(KEY)
}

/** fetch() with this display's bearer token. */
export function deviceFetch(path: string, token: string, init: RequestInit = {}) {
  return fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...init.headers, Authorization: `Bearer ${token}` },
  })
}
