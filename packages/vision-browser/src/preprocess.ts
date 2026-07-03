export const MODEL_INPUT_SIZE = 640;
// Ultralytics' letterbox padding color (0-255 gray), not black — matching this
// exactly avoids shifting confidence scores near image borders.
const PAD_COLOR = "rgb(114,114,114)";

/**
 * Resize+pad a video frame to the model's fixed 640x640 input, preserving
 * aspect ratio (Ultralytics' letterbox convention: longer side -> 640, pad the
 * shorter side symmetrically with gray), then convert to a normalized NCHW
 * Float32Array. Uses OffscreenCanvas so this runs inside a Web Worker (no
 * DOM/window APIs) as well as the main thread.
 *
 * No bbox rescaling info is returned — the wire contract this feeds
 * (PRODUCT_DETECTED) only carries label/confidence, never a bounding box.
 */
export function preprocessFrame(image: ImageBitmap): Float32Array {
  const { width: srcW, height: srcH } = image;
  const scale = Math.min(MODEL_INPUT_SIZE / srcW, MODEL_INPUT_SIZE / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const padX = Math.floor((MODEL_INPUT_SIZE - newW) / 2);
  const padY = Math.floor((MODEL_INPUT_SIZE - newH) / 2);

  const canvas = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[preprocess] Could not get 2D context from OffscreenCanvas");

  ctx.fillStyle = PAD_COLOR;
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  ctx.drawImage(image, 0, 0, srcW, srcH, padX, padY, newW, newH);

  const { data } = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  // data is RGBA HWC uint8 (already RGB order — no BGR swap needed; that's a
  // Python/OpenCV-capture-only detail, Ultralytics converts to RGB internally
  // before the model ever sees a frame). Convert to normalized NCHW float32.
  const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const tensor = new Float32Array(3 * pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4;
    tensor[i] = data[srcIdx]! / 255; // R plane
    tensor[pixelCount + i] = data[srcIdx + 1]! / 255; // G plane
    tensor[2 * pixelCount + i] = data[srcIdx + 2]! / 255; // B plane
  }
  return tensor;
}
