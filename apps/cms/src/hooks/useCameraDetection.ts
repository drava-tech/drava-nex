"use client";

import { useEffect, useRef } from "react";
import { StabilityFilter, StabilityEvent, type VisionConfig } from "@platform/vision-browser";
import type { WsClientMessage } from "@platform/types";
import type { DetectionWorkerRequest, DetectionWorkerResponse } from "@/workers/detection.worker";

// Mirrors CAMERA_SCREEN_MAP (server-side, .env.production) inverted for
// client-side lookup — the browser now owns the full camera lifecycle that
// the native product-vision service used to (CAMERA_REGISTER/HEARTBEAT
// included), so it can't rely on a CAMERA_STATUS_UPDATE from that service to
// learn its own cameraId anymore; it has to know it upfront.
const SCREEN_TO_CAMERA: Record<string, string> = {
  "main-screen": "camera-01",
  "screen-2": "camera-02",
};

// Browsers only expose OS device labels, not our logical camera-01/camera-02
// IDs — matches the label-hint pattern proven earlier for camera selection.
const CAMERA_LABEL_HINTS: Record<string, string> = {
  "camera-01": "Lenovo",
  "camera-02": "RealSense",
};

const DETECTION_LABEL = "coster";
const MODEL_URL = "/display/models/coster-v1.onnx";
const CAPTURE_INTERVAL_MS = 200; // throttled sampling, matches the stability filter's tolerance
const HEARTBEAT_INTERVAL_MS = 5_000; // matches the native service's cadence
const VISION_CONFIG: VisionConfig = {
  confidenceThreshold: 0.4, // aligned with DETECTION_MIN_CONFIDENCE (.env.production)
  stabilityFrames: 5,
  lostFrames: 10,
};
// Mirrors VISION_HOLD_PRODUCT=true (live today): suppress PRODUCT_LOST, keep
// showing the last detected product rather than reverting automatically.
const HOLD_PRODUCT = true;

interface UseCameraDetectionOptions {
  screenId: string;
  sendRaw: (msg: WsClientMessage) => void;
}

/**
 * Runs camera detection entirely in the browser: getUserMedia -> Web Worker
 * (ONNX inference, off the main thread) -> stability filter -> WS events.
 * Fully replaces the native product-vision service for whichever camera this
 * screen is mapped to — including CAMERA_REGISTER/HEARTBEAT, not just
 * detection events (see the plan's Rollout section for the native/browser
 * handoff). No-ops if this screen has no camera mapped (SCREEN_TO_CAMERA).
 */
export function useCameraDetection({ screenId, sendRaw }: UseCameraDetectionOptions): void {
  const sendRawRef = useRef(sendRaw);
  sendRawRef.current = sendRaw;

  useEffect(() => {
    const resolvedCameraId = SCREEN_TO_CAMERA[screenId];
    if (!resolvedCameraId) return;
    // Rebind to a freshly-typed const — TS's narrowing above doesn't carry
    // into the nested function closures defined below (captured, not inlined).
    const cameraId: string = resolvedCameraId;
    if (typeof window === "undefined" || !navigator.mediaDevices) {
      console.warn(
        "[useCameraDetection] navigator.mediaDevices is unavailable — this page isn't loaded " +
          "in a secure context (https, or localhost/127.0.0.1)."
      );
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let worker: Worker | null = null;
    let captureTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let inflight = false;
    const stability = new StabilityFilter(VISION_CONFIG);

    function sendHeartbeat() {
      sendRawRef.current({ type: "CAMERA_HEARTBEAT", cameraId, sentAt: new Date().toISOString() });
    }

    async function start() {
      sendRawRef.current({ type: "CAMERA_REGISTER", cameraId, registeredAt: new Date().toISOString() });
      heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

      try {
        const hint = CAMERA_LABEL_HINTS[cameraId];
        let deviceId: string | undefined;
        if (hint) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          deviceId = devices.find(
            (d) => d.kind === "videoinput" && d.label.toLowerCase().includes(hint.toLowerCase())
          )?.deviceId;
        }
        const media = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;

        video = document.createElement("video");
        video.srcObject = media;
        video.muted = true;
        video.playsInline = true;
        video.style.position = "fixed";
        video.style.left = "-9999px";
        document.body.appendChild(video);
        await video.play();

        worker = new Worker(new URL("../workers/detection.worker.ts", import.meta.url));
        worker.onmessage = (evt: MessageEvent<DetectionWorkerResponse>) => {
          const msg = evt.data;
          if (msg.type === "error") {
            console.error("[useCameraDetection] Worker error:", msg.message);
            sendRawRef.current({ type: "CAMERA_STATUS", cameraId, status: "camera_unavailable", message: msg.message });
            inflight = false;
            return;
          }
          if (msg.type === "loaded") {
            sendRawRef.current({ type: "CAMERA_STATUS", cameraId, status: "waiting" });
            captureTimer = setInterval(captureAndDetect, CAPTURE_INTERVAL_MS);
            return;
          }
          if (msg.type === "result") {
            inflight = false;
            handleDetection(msg.detection);
          }
        };

        const loadMsg: DetectionWorkerRequest = {
          type: "load",
          modelUrl: MODEL_URL,
          label: DETECTION_LABEL,
          confidenceThreshold: VISION_CONFIG.confidenceThreshold,
        };
        worker.postMessage(loadMsg);
      } catch (e) {
        console.warn("[useCameraDetection] Failed to start:", e);
        sendRawRef.current({ type: "CAMERA_STATUS", cameraId, status: "camera_unavailable", message: String(e) });
      }
    }

    function captureAndDetect() {
      if (cancelled || inflight || !video || !worker) return;
      if (video.videoWidth === 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      inflight = true;
      createImageBitmap(video)
        .then((bitmap) => {
          if (cancelled || !worker) {
            bitmap.close();
            inflight = false;
            return;
          }
          const msg: DetectionWorkerRequest = { type: "detect", image: bitmap };
          worker.postMessage(msg, [bitmap]);
        })
        .catch(() => {
          inflight = false;
        });
    }

    function handleDetection(detection: { label: string; confidence: number } | null) {
      const event = stability.update(detection);
      if (event === StabilityEvent.PRODUCT_DETECTED && stability.currentDetection) {
        const d = stability.currentDetection;
        sendRawRef.current({
          type: "PRODUCT_DETECTED",
          cameraId,
          label: d.label,
          confidence: d.confidence,
          detectedAt: new Date().toISOString(),
        });
      } else if (event === StabilityEvent.PRODUCT_LOST && !HOLD_PRODUCT) {
        sendRawRef.current({
          type: "PRODUCT_LOST",
          cameraId,
          label: DETECTION_LABEL,
          lostAt: new Date().toISOString(),
        });
      }
    }

    start();

    return () => {
      cancelled = true;
      if (captureTimer) clearInterval(captureTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      worker?.terminate();
      stream?.getTracks().forEach((t) => t.stop());
      video?.remove();
    };
  }, [screenId]);
}
