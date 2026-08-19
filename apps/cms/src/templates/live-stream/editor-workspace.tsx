"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Check, Copy, Sparkles, RefreshCw } from "lucide-react";
import type { Experience } from "@platform/db";
import { updateExperienceTemplateContent } from "@/actions/experience-actions";
import {
  ScreenStage,
} from "@platform/ui/templates/portfolio";
import {
  LiveStreamCanvas,
  DEFAULT_LIVE_STREAM_CONTENT,
  type LiveStreamContent,
  type StreamFit,
} from "@platform/ui/templates/live-stream";

/**
 * Full-tab editor for the Live Stream template: a form (stream id, label, fit) +
 * the connection instructions to paste into the publisher EXE, with a live preview
 * of the actual stream on the right.
 */
export function LiveStreamEditorWorkspace({
  experience,
  initialContent,
}: {
  experience: Experience;
  initialContent: LiveStreamContent;
}) {
  const router = useRouter();
  const [streamId, setStreamId] = useState(initialContent?.streamId ?? DEFAULT_LIVE_STREAM_CONTENT.streamId);
  const [label, setLabel] = useState(initialContent?.label ?? "");
  const [fit, setFit] = useState<StreamFit>(initialContent?.fit ?? "cover");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [wsLink, setWsLink] = useState("");

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    setWsLink(`${proto}//${window.location.host}/ws/`);
  }, []);

  const trimmedId = streamId.trim();
  const content: LiveStreamContent = {
    streamId: trimmedId,
    label: label.trim() || undefined,
    fit,
  };

  const handshake = `{"type":"STREAM_PUBLISH","streamId":"${trimmedId || "stream-id"}","format":"h264"}`;

  const persist = (next: LiveStreamContent) => {
    setError(null);
    startTransition(async () => {
      const res = await updateExperienceTemplateContent(experience.id, "live-stream", next);
      if (res.success) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "Failed to save.");
      }
    });
  };

  const save = () => persist(content);

  // Generate a unique stream id and persist it immediately so the link is valid
  // right away. Math.random (not crypto.randomUUID, which is undefined on the
  // plain-HTTP LAN deployment) — this is a routing key, not a secret.
  const generate = () => {
    const base = experience.slug || "stream";
    const rand = Math.random().toString(36).slice(2, 6);
    const id = `stream-${base}-${rand}`;
    setStreamId(id);
    setSaved(false);
    persist({ streamId: id, label: label.trim() || undefined, fit });
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(trimmedId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const copyHandshake = async () => {
    try {
      await navigator.clipboard.writeText(handshake);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-zinc-100 dark:bg-zinc-950">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 px-4 h-14 shrink-0 border-b border-[#432992] bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/experiences"
            className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            title="Back to experiences"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {experience.name}
            </p>
            <p className="text-[11px] text-zinc-400">Live Stream</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/preview/experiences/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View
          </a>
          <button
            onClick={save}
            disabled={isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-bold disabled:opacity-50 min-w-[84px] justify-center"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saved ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {isPending ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        </div>
      </header>

      {/* Body: content panel + live preview */}
      <div className="flex-1 flex min-h-0">
        <aside className="w-[400px] shrink-0 border-r border-[#432992] bg-white dark:bg-zinc-900 overflow-y-auto p-4 flex flex-col gap-4">
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 mb-3">
              Stream
            </h2>
            <div className="flex flex-col gap-3">
              <Field label="Stream URL">
                {trimmedId ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-stretch gap-1.5">
                      <code className="flex-1 block text-sm font-mono bg-zinc-100 dark:bg-zinc-800 border border-[#432992] rounded-md px-2.5 py-2 text-zinc-900 dark:text-zinc-100 break-all">
                        {trimmedId}
                      </code>
                      <button
                        onClick={copyId}
                        title="Copy stream id"
                        className="shrink-0 px-2 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500"
                      >
                        {copiedId ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <button
                      onClick={generate}
                      disabled={isPending}
                      className="self-start flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" /> Regenerate
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={generate}
                      disabled={isPending}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Generate Stream URL
                    </button>
                    <p className="text-[11px] text-zinc-400">Creates a unique link to connect your EXE.</p>
                  </div>
                )}
              </Field>
              <Field label="Caption (optional)">
                <input
                  type="text"
                  value={label}
                  disabled={isPending}
                  placeholder="Shown over the feed"
                  onChange={(e) => {
                    setSaved(false);
                    setLabel(e.target.value);
                  }}
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-[#432992] rounded-md px-2.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
                />
              </Field>
              <Field label="Fit">
                <select
                  value={fit}
                  disabled={isPending}
                  onChange={(e) => {
                    setSaved(false);
                    setFit(e.target.value as StreamFit);
                  }}
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-[#432992] rounded-md px-2.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
                >
                  <option value="cover">Cover (fill, crop edges)</option>
                  <option value="contain">Contain (letterbox)</option>
                </select>
              </Field>
            </div>
          </div>

          {/* Connection instructions for the publisher EXE — shown once a URL is generated */}
          {trimmedId && (
          <div className="rounded-xl border border-[#432992] p-4 flex flex-col gap-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              Connect your stream (EXE)
            </h3>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                WebSocket link
              </span>
              <code className="block text-xs font-mono bg-zinc-100 dark:bg-zinc-800 rounded-md px-2.5 py-2 text-zinc-900 dark:text-zinc-100 break-all">
                {wsLink || "ws://…/ws/"}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                First message (then send binary frames)
              </span>
              <div className="flex items-stretch gap-1.5">
                <code className="flex-1 block text-[11px] leading-relaxed font-mono bg-zinc-100 dark:bg-zinc-800 rounded-md px-2.5 py-2 text-zinc-900 dark:text-zinc-100 break-all">
                  {handshake}
                </code>
                <button
                  onClick={copyHandshake}
                  title="Copy handshake"
                  className="shrink-0 px-2 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Frame = <span className="font-mono">[type:1B][timestamp:8B LE][payload]</span> ·
              type 0 = config, 1 = keyframe, 2 = delta. Use H.264 (Annex-B) and send a
              keyframe every 1–2s. Default audio off (video-only).
            </p>
          </div>
          )}

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </aside>

        <main className="flex-1 min-w-0 p-6 bg-zinc-200 dark:bg-zinc-900/40">
          <ScreenStage>
            <div style={{ width: 1920, height: 1080 }}>
              <LiveStreamCanvas streamId={trimmedId} fit={fit} label={content.label} />
            </div>
          </ScreenStage>
        </main>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  );
}
