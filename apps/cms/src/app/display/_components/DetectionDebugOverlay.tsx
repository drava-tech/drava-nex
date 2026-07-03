"use client";

import { useEffect, useRef, useState } from "react";
import type { ServerDetectionResponse } from "@platform/vision-browser";

interface DetectionDebugOverlayProps {
  stream: MediaStream | null;
  lastResult: ServerDetectionResponse | null;
  status: "connecting" | "connected" | "disconnected";
  cameraId: string | null;
  stats: { rttMs: number; processingTimeMs: number };
}

export function DetectionDebugOverlay({
  stream,
  lastResult,
  status,
  cameraId,
  stats,
}: DetectionDebugOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!video || !canvas || !container) return;

    const handleDraw = () => {
      const videoW = video.videoWidth;
      const videoH = video.videoHeight;
      if (videoW === 0 || videoH === 0) return;

      const elemW = container.clientWidth;
      const elemH = container.clientHeight;

      const scale = Math.min(elemW / videoW, elemH / videoH);
      const contentW = videoW * scale;
      const contentH = videoH * scale;
      const offX = (elemW - contentW) / 2;
      const offY = (elemH - contentH) / 2;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = elemW * dpr;
      canvas.height = elemH * dpr;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, elemW, elemH);

      if (!lastResult || !lastResult.detections) return;

      lastResult.detections.forEach((det) => {
        const { x, y, width, height } = det.box;

        const pxX = offX + x * contentW;
        const pxY = offY + y * contentH;
        const pxW = width * contentW;
        const pxH = height * contentH;

        ctx.strokeStyle = "#00ff00";
        ctx.lineWidth = 2;
        ctx.strokeRect(pxX, pxY, pxW, pxH);

        ctx.fillStyle = "#00ff00";
        ctx.font = "bold 12px Inter, system-ui, sans-serif";
        const text = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
        const textWidth = ctx.measureText(text).width;
        
        ctx.fillRect(pxX, pxY - 18, textWidth + 8, 18);
        ctx.fillStyle = "#000000";
        ctx.fillText(text, pxX + 4, pxY - 5);
      });
    };

    video.addEventListener("play", handleDraw);
    video.addEventListener("loadedmetadata", handleDraw);

    const observer = new ResizeObserver(() => {
      handleDraw();
    });
    observer.observe(container);

    handleDraw();

    return () => {
      video.removeEventListener("play", handleDraw);
      video.removeEventListener("loadedmetadata", handleDraw);
      observer.disconnect();
    };
  }, [lastResult, dimensions]);

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      setDimensions({
        width: videoRef.current.videoWidth,
        height: videoRef.current.videoHeight,
      });
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-4 w-72 aspect-[16/9] border-2 border-zinc-700 bg-zinc-950 rounded-xl overflow-hidden shadow-2xl z-50 flex flex-col"
    >
      <div className="relative flex-1 min-h-0">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onLoadedMetadata={handleVideoLoaded}
          className="w-full h-full object-contain"
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />
        <span
          className={`absolute top-2 right-2 h-3.5 w-3.5 rounded-full border border-zinc-950 ${
            status === "connected"
              ? "bg-green-500"
              : status === "connecting"
                ? "bg-amber-500 animate-pulse"
                : "bg-red-500"
          }`}
          title={`Server WebSocket: ${status}`}
        />
      </div>

      <div className="bg-zinc-900 border-t border-zinc-800 p-2 font-mono text-[9px] text-zinc-400 select-none leading-relaxed shrink-0">
        <div className="flex justify-between">
          <span>CAMERA: {cameraId || "N/A"}</span>
          <span>WS: <span className={status === "connected" ? "text-green-400" : "text-red-400"}>{status.toUpperCase()}</span></span>
        </div>
        <div className="flex justify-between mt-0.5">
          <span>PROC: {stats.processingTimeMs.toFixed(1)}ms</span>
          <span>RTT: {stats.rttMs.toFixed(0)}ms</span>
        </div>
        {lastResult && lastResult.inference && (
          <div className="text-zinc-500 text-[8px] mt-0.5 truncate">
            {lastResult.inference.device}
          </div>
        )}
      </div>
    </div>
  );
}
