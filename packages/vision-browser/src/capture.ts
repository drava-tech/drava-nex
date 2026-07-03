/**
 * Downscale and compress a video frame to a JPEG blob using OffscreenCanvas.
 * uniform downscale, aspect preserved, maxSide ceiling.
 */
export async function captureJpegFrame(
  video: HTMLVideoElement,
  options: { maxSide: number; quality: number }
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;
  if (videoW === 0 || videoH === 0) return null;

  let targetW = videoW;
  let targetH = videoH;
  if (videoW > options.maxSide || videoH > options.maxSide) {
    if (videoW > videoH) {
      targetW = options.maxSide;
      targetH = Math.round((videoH * options.maxSide) / videoW);
    } else {
      targetH = options.maxSide;
      targetW = Math.round((videoW * options.maxSide) / videoH);
    }
  }

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(targetW, targetH);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, targetW, targetH);

  let blob: Blob | null = null;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: options.quality });
  } else {
    blob = await new Promise<Blob | null>((resolve) => {
      (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), "image/jpeg", options.quality);
    });
  }

  if (!blob) return null;
  return { blob, width: targetW, height: targetH };
}
