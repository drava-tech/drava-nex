"use client";

import { useEffect, useRef, useState } from "react";
import {
  StabilityFilter,
  StabilityEvent,
  VISION_CONFIG,
  VISION_DEFAULTS,
  ServerDetectionClient,
  captureJpegFrame,
  type ServerDetectionResponse,
} from "@platform/vision-browser";
import type { WsClientMessage } from "@platform/types";
import { resolveBrowserWsUrl } from "@/lib/display/client-urls";
import { SCREEN_TO_CAMERA, CAMERA_LABEL_HINTS, DETECTION_LABEL } from "../lib/display/camera-config";

interface UseServerDetectionOptions {
  screenId: string;
  sendRaw: (msg: WsClientMessage) => void;
  enabled?: boolean;
}

export function useServerDetection({
  screenId,
  sendRaw,
  enabled = true,
}: UseServerDetectionOptions) {
  const sendRawRef = useRef(sendRaw);
  sendRawRef.current = sendRaw;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [lastResult, setLastResult] = useState<ServerDetectionResponse | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [cameraId, setCameraId] = useState<string | null>(null);

  const statsRef = useRef({ rttMs: 0, processingTimeMs: 0 });

  useEffect(() => {
    if (!enabled) return;

    const resolvedCameraId = SCREEN_TO_CAMERA[screenId];
    if (!resolvedCameraId) return;
    const cid = resolvedCameraId;
    setCameraId(cid);

    if (typeof window === "undefined" || !navigator.mediaDevices) {
      console.warn(
        "[useServerDetection] navigator.mediaDevices is unavailable."
      );
      return;
    }

    let cancelled = false;
    let mediaStream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let captureTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let inflight = false;
    const stability = new StabilityFilter(VISION_CONFIG);

    const rawWsUrl = process.env.NEXT_PUBLIC_VISION_WS_URL || "/vision/ws";
    const wsUrl = resolveBrowserWsUrl(rawWsUrl);
    const client = new ServerDetectionClient(wsUrl);

    function sendHeartbeat() {
      sendRawRef.current({ type: "CAMERA_HEARTBEAT", cameraId: cid, sentAt: new Date().toISOString() });
    }

    client.onStatusChange = (newStatus) => {
      setStatus(newStatus);
      if (newStatus === "disconnected") {
        sendRawRef.current({
          type: "CAMERA_STATUS",
          cameraId: cid,
          status: "service_offline",
          message: "Vision inference server connection lost.",
        });
      }
    };

    client.onMessage = (msg) => {
      if (cancelled) return;

      if (msg.type === "ready") {
        sendRawRef.current({ type: "CAMERA_STATUS", cameraId: cid, status: "waiting" });
        return;
      }

      if (msg.type === "error") {
        inflight = false;
        console.error("[useServerDetection] Server error:", msg.message);
        return;
      }

      if (msg.type === "detections") {
        inflight = false;
        setLastResult(msg);

        const currentStats = client.getStats();
        statsRef.current = {
          rttMs: currentStats.rttMs,
          processingTimeMs: currentStats.processingTimeMs,
        };

        let bestDetection = null;
        if (msg.detections && msg.detections.length > 0) {
          const initial = msg.detections[0]!;
          bestDetection = msg.detections.reduce((best, cur) =>
            cur.confidence > best.confidence ? cur : best,
            initial
          );
        }

        const mappedDetection = bestDetection
          ? { label: bestDetection.label, confidence: bestDetection.confidence }
          : null;

        const event = stability.update(mappedDetection);
        if (event === StabilityEvent.PRODUCT_DETECTED && stability.currentDetection) {
          const d = stability.currentDetection;
          sendRawRef.current({
            type: "PRODUCT_DETECTED",
            cameraId: cid,
            label: d.label,
            confidence: d.confidence,
            detectedAt: new Date().toISOString(),
          });
        } else if (event === StabilityEvent.PRODUCT_LOST && !VISION_DEFAULTS.holdProduct) {
          sendRawRef.current({
            type: "PRODUCT_LOST",
            cameraId: cid,
            label: DETECTION_LABEL,
            lostAt: new Date().toISOString(),
          });
        }
      }
    };

    async function start() {
      sendRawRef.current({ type: "CAMERA_REGISTER", cameraId: cid, registeredAt: new Date().toISOString() });
      heartbeatTimer = setInterval(sendHeartbeat, 5000);

      client.connect();

      try {
        const hint = CAMERA_LABEL_HINTS[cid];
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasPermission = devices.some((d) => d.label !== "");

        let deviceId: string | undefined;
        if (hint && hasPermission) {
          deviceId = devices.find(
            (d) => d.kind === "videoinput" && d.label.toLowerCase().includes(hint.toLowerCase())
          )?.deviceId;

          if (!deviceId) {
            console.log(`[useServerDetection] Mapped camera device "${hint}" not found. Skipping.`);
            sendRawRef.current({
              type: "CAMERA_STATUS",
              cameraId: cid,
              status: "camera_unavailable",
              message: `Camera device "${hint}" not found.`,
            });
            return;
          }
        }

        const media = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
        });

        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }

        mediaStream = media;
        setStream(media);

        video = document.createElement("video");
        video.srcObject = media;
        video.muted = true;
        video.playsInline = true;
        video.style.position = "fixed";
        video.style.left = "-9999px";
        document.body.appendChild(video);
        await video.play();

        captureTimer = setInterval(captureAndDetect, VISION_DEFAULTS.captureIntervalMs);
      } catch (e) {
        console.warn("[useServerDetection] Failed to start:", e);
        sendRawRef.current({
          type: "CAMERA_STATUS",
          cameraId: cid,
          status: "camera_unavailable",
          message: String(e),
        });
      }
    }

    async function captureAndDetect() {
      if (cancelled || inflight || !video) return;
      if (video.videoWidth === 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      inflight = true;
      try {
        const frameData = await captureJpegFrame(video, {
          maxSide: VISION_DEFAULTS.maxSide,
          quality: VISION_DEFAULTS.quality,
        });

        if (!frameData || cancelled) {
          inflight = false;
          return;
        }

        client.sendFrame(frameData.blob);
      } catch (err) {
        inflight = false;
      }
    }

    start();

    return () => {
      cancelled = true;
      if (captureTimer) clearInterval(captureTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      client.disconnect();
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
      if (video) {
        video.remove();
      }
      setStream(null);
      setLastResult(null);
    };
  }, [screenId, enabled]);

  return {
    stream,
    lastResult,
    stats: statsRef.current,
    status,
    cameraId,
  };
}
