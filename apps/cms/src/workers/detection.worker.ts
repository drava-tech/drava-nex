/// <reference lib="webworker" />
import { Detector, type Detection } from "@platform/vision-browser";

export type DetectionWorkerRequest =
  | { type: "load"; modelUrl: string; label: string; confidenceThreshold: number }
  | { type: "detect"; image: ImageBitmap };

export type DetectionWorkerResponse =
  | { type: "loaded" }
  | { type: "result"; detection: Detection | null }
  | { type: "error"; message: string };

let detector: Detector | null = null;

self.onmessage = async (evt: MessageEvent<DetectionWorkerRequest>) => {
  const msg = evt.data;

  if (msg.type === "load") {
    try {
      detector = new Detector(msg.modelUrl, msg.label, msg.confidenceThreshold);
      await detector.load();
      const response: DetectionWorkerResponse = { type: "loaded" };
      self.postMessage(response);
    } catch (e) {
      const response: DetectionWorkerResponse = { type: "error", message: String(e) };
      self.postMessage(response);
    }
    return;
  }

  if (msg.type === "detect") {
    try {
      if (!detector) throw new Error("Detector not loaded — send 'load' first");
      const detection = await detector.detect(msg.image);
      msg.image.close();
      const response: DetectionWorkerResponse = { type: "result", detection };
      self.postMessage(response);
    } catch (e) {
      msg.image.close();
      const response: DetectionWorkerResponse = { type: "error", message: String(e) };
      self.postMessage(response);
    }
  }
};
