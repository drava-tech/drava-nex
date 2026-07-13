export const SCREEN_TO_CAMERA: Record<string, string> = {
  "main-screen": "camera-01",
  "screen-2": "camera-02",
};

export const CAMERA_LABEL_HINTS: Record<string, string> = {
  "camera-01": "realsense1",
  "camera-02": "realsense2",
  "camera-03": "tablet camera",
};

/** Single source of truth for the cameras available to pick from in the CMS UI. */
export interface CameraOption {
  id: string;
  label: string;
}

export const CAMERAS: CameraOption[] = [
  { id: "camera-01", label: "Camera 1 · RealSense 1" },
  { id: "camera-02", label: "Camera 2 · RealSense 2" },
  { id: "camera-03", label: "Camera 3 · Tablet camera" },
];

export const DETECTION_LABEL = "coster";
