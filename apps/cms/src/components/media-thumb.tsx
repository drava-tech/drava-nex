"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Link as LinkIcon,
  Presentation,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  image: { icon: ImageIcon, label: "Image" },
  video: { icon: Film, label: "Video" },
  document: { icon: FileText, label: "PDF" },
  word: { icon: FileText, label: "Doc" },
  sheet: { icon: FileSpreadsheet, label: "Sheet" },
  presentation: { icon: Presentation, label: "Slides" },
  link: { icon: LinkIcon, label: "Link" },
  youtube: { icon: Film, label: "YouTube" },
  experience: { icon: SquareTerminal, label: "Experience" },
};

/**
 * A media (or experience) preview that never shows a broken image: the
 * picture when there is one and it loads, otherwise an icon and type label.
 * `name` is used only for documents and the like, which have no picture to
 * tell them apart; everything else keeps its name in the tooltip.
 */
export function MediaThumb({
  type,
  src,
  videoSrc,
  name,
  compact = false,
  className = "",
}: {
  /** media_asset.type, or "experience". */
  type: string;
  /** An image URL (the thumbnail, or the image itself); null for none. */
  src: string | null;
  /**
   * Videos: the file itself. With no thumbnail image, its first frame is the
   * preview (only the header is fetched, as on the Media page).
   */
  videoSrc?: string | null;
  name?: string;
  /** Icon only — for small slots like a queue row. */
  compact?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const meta = ICONS[type] ?? { icon: FileText, label: type ? type[0]!.toUpperCase() + type.slice(1) : "File" };
  const Icon = meta.icon;
  const hasPicture = !!src && !failed;
  const hasFrame = !hasPicture && type === "video" && !!videoSrc && !videoFailed;

  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-muted ${className}`} title={name}>
      {hasPicture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : hasFrame ? (
        <video
          // #t: a moment in, so a fade-from-black opening doesn't give a black tile.
          src={`${videoSrc}#t=0.5`}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          tabIndex={-1}
          aria-hidden
          onError={() => setVideoFailed(true)}
          className="pointer-events-none h-full w-full object-cover"
        />
      ) : compact ? (
        <Icon className="h-4 w-4 text-muted-foreground" />
      ) : (
        <div className="flex min-w-0 flex-col items-center gap-1 px-2 text-center">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{meta.label}</span>
          {name && type !== "image" && type !== "video" && (
            <span className="line-clamp-2 max-w-full break-words text-[10px] leading-tight text-foreground/70">{name}</span>
          )}
        </div>
      )}
      {/* Tells a video from a still at a glance. */}
      {(hasPicture || hasFrame) && type === "video" && !compact && (
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          <Film className="h-3 w-3" />
          Video
        </span>
      )}
    </div>
  );
}
