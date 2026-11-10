"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  X,
  Check,
  Search,
  Image as ImageIcon,
  Video,
  Loader2,
  Star,
  LayoutTemplate,
} from "lucide-react";
import type { WsContent } from "@platform/types";
import { mediaThumbnailSrc } from "@/lib/media-tiles";

interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
  size: string;
  date: string;
  /** Small derived tile; null for videos and pre-backfill images. */
  thumbnailUrl?: string | null;
}

/** One "Recently Opened" entry — either a media asset or an experience. */
interface RecentContentItem {
  id: string;
  kind: "media" | "experience";
  name: string;
  type: string;
  url: string | null;
  size: string;
  date: string;
}

interface ScreenAssignmentPickerProps {
  screenId: string;
  screenName: string;
  currentContentLabel?: string;
  currentDefaultMediaAssetId?: string | null;
  experiences: { id: string; title: string }[];
  onAssign: (content: WsContent) => void;
  onSetDefault?: (item: { id: string; name: string }) => void;
  onClose: () => void;
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

function formatPushedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

/** One media thumbnail card — shared by the Files and Recently Opened tabs. */
function MediaCard({
  media,
  isActive,
  isDefault,
  onSelect,
  onSetDefault,
}: {
  media: MediaItem;
  isActive: boolean;
  isDefault: boolean;
  onSelect: () => void;
  onSetDefault?: (item: { id: string; name: string }) => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`relative flex flex-col bg-zinc-50 dark:bg-[#111] rounded-2xl border transition-all duration-300 overflow-hidden text-left group
        ${
          isActive
            ? "border-border bg-zinc-100 dark:bg-zinc-900 ring-2 ring-zinc-900/10 dark:ring-zinc-100/10 shadow-lg"
            : "border-border hover:border-zinc-400 dark:hover:border-white/25 hover:shadow-md"
        }`}
    >
      {/* Thumbnail preview */}
      <div className="aspect-[16/10] w-full bg-zinc-100 dark:bg-zinc-800/40 relative overflow-hidden flex items-center justify-center border-b border-border">
        {media.type === "video" ? (
          <video
            src={media.url}
            className="w-full h-full object-cover"
            // Without this the browser buffers megabytes of every video in the
            // grid just to draw a tile — same fix the media library already
            // carries. "metadata" still paints the first frame.
            preload="metadata"
            muted
            playsInline
          />
        ) : (
          <img
            // The derived tile, not the original upload.
            src={mediaThumbnailSrc(media)}
            alt={media.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        )}
        {/* Badge tag */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-[9px] font-bold tracking-wide uppercase">
          {media.type === "video" ? (
            <Video className="w-2.5 h-2.5" />
          ) : (
            <ImageIcon className="w-2.5 h-2.5" />
          )}
          {media.type}
        </div>
        {/* Set-as-default toggle */}
        {onSetDefault && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSetDefault({ id: media.id, name: media.name });
            }}
            title={isDefault ? "Default for this screen" : "Set as default"}
            className={`absolute top-2 left-2 p-1 rounded-full backdrop-blur-sm transition-colors ${
              isDefault
                ? "bg-amber-400 text-amber-950"
                : "bg-black/40 text-white/70 hover:text-white hover:bg-black/60"
            }`}
          >
            <Star
              className="w-2.5 h-2.5"
              fill={isDefault ? "currentColor" : "none"}
            />
          </div>
        )}
      </div>

      {/* Title and metadata */}
      <div className="p-3 w-full flex flex-col gap-0.5">
        <h4
          className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate w-full"
          title={media.name}
        >
          {media.name}
        </h4>
        <div className="flex items-center justify-between text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
          <span>{media.size}</span>
          <span>{media.date}</span>
        </div>
      </div>

      {isActive && (
        <div className="absolute top-2.5 right-2.5 p-1 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-md">
          <Check className="h-2.5 w-2.5 shrink-0" />
        </div>
      )}
    </button>
  );
}

function ExperienceRecentCard({
  item,
  isActive,
  onSelect,
}: {
  item: { id: string; name: string };
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`relative flex flex-col bg-zinc-50 dark:bg-[#111] rounded-2xl border transition-all duration-300 overflow-hidden text-left group
        ${
          isActive
            ? "border-border bg-zinc-100 dark:bg-zinc-900 ring-2 ring-zinc-900/10 dark:ring-zinc-100/10 shadow-lg"
            : "border-border hover:border-zinc-400 dark:hover:border-white/25 hover:shadow-md"
        }`}
    >
      <div className="aspect-[16/10] w-full bg-zinc-100 dark:bg-zinc-800/40 relative overflow-hidden flex items-center justify-center border-b border-border">
        <LayoutTemplate className="w-6 h-6 text-zinc-400 dark:text-zinc-600" />
        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-[9px] font-bold tracking-wide uppercase">
          Portfolio
        </div>
      </div>
      <div className="p-3 w-full flex flex-col gap-0.5">
        <h4
          className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate w-full"
          title={item.name}
        >
          {item.name}
        </h4>
      </div>
      {isActive && (
        <div className="absolute top-2.5 right-2.5 p-1 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-md">
          <Check className="h-2.5 w-2.5 shrink-0" />
        </div>
      )}
    </button>
  );
}

export function ScreenAssignmentPicker({
  screenId,
  screenName,
  currentContentLabel,
  currentDefaultMediaAssetId,
  experiences,
  onAssign,
  onSetDefault,
  onClose,
}: ScreenAssignmentPickerProps) {
  const [activeTab, setActiveTab] = useState<
    "experiences" | "files" | "recent"
  >("experiences");
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [recentItems, setRecentItems] = useState<RecentContentItem[]>([]);

  /** Keyset cursor for the next page of media, or null at the end of the list. */
  const [mediaCursor, setMediaCursor] = useState<string | null>(null);
  const [loadingMoreMedia, setLoadingMoreMedia] = useState(false);
  /** Search runs on the server now, so a screen can be pointed at any asset in
   *  the library — not only one that happened to be in the first page. */
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const mediaSeqRef = useRef(0);

  /**
   * One page of image/video assets. Type filtering and search are both applied
   * by the API — this used to download the whole media library and discard
   * every non-image/video row in the browser.
   */
  const loadMedia = useCallback(
    async (cursor: string | null) => {
      const seq = cursor === null ? ++mediaSeqRef.current : mediaSeqRef.current;
      if (cursor === null) setLoadingMedia(true);
      else setLoadingMoreMedia(true);
      try {
        const params = new URLSearchParams({
          mode: "cursor",
          limit: "48",
          // Only image and video render on a screen.
          types: "image,video",
        });
        if (debouncedSearch.trim())
          params.set("search", debouncedSearch.trim());
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/media?${params.toString()}`);
        const data = res.ok ? await res.json() : null;
        if (seq !== mediaSeqRef.current) return;
        const page: MediaItem[] = data?.media ?? [];
        setMediaItems((prev) => (cursor === null ? page : [...prev, ...page]));
        setMediaCursor(data?.nextCursor ?? null);
      } catch (err) {
        console.error("Failed to load media in picker:", err);
      } finally {
        if (seq === mediaSeqRef.current) {
          setLoadingMedia(false);
          setLoadingMoreMedia(false);
        }
      }
    },
    [debouncedSearch],
  );

  // Restart the walk when the tab opens, and whenever the search term settles.
  useEffect(() => {
    if (activeTab !== "files") return;
    void loadMedia(null);
  }, [activeTab, loadMedia]);

  const mediaSentinelRef = useInfiniteScroll({
    hasMore: mediaCursor !== null,
    loading: loadingMedia || loadingMoreMedia,
    onLoadMore: () => void loadMedia(mediaCursor),
  });

  const [loadingRecentItems, setLoadingRecentItems] = useState(false);

  // Per-screen "recently pushed to this screen" shortlist (server-recorded,
  // capped at 5 server-side — see getRecentContentForScreen; covers both
  // media and experience pushes) — reloaded whenever the tab is opened or
  // the picker is pointed at a different screen.
  useEffect(() => {
    if (activeTab !== "recent") return;
    setLoadingRecentItems(true);
    fetch(`/api/screens/${screenId}/recent-content`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const items: RecentContentItem[] = (data.items || []).map(
          (item: any) => ({
            id: item.id,
            kind: item.kind,
            name: item.name,
            type: item.type,
            url: item.url,
            size: formatFileSize(item.sizeBytes),
            date: formatPushedAt(item.pushedAt),
          }),
        );
        setRecentItems(items);
      })
      .catch((err) =>
        console.error("Failed to load recent content for screen:", err),
      )
      .finally(() => setLoadingRecentItems(false));
  }, [activeTab, screenId]);

  const handleSelectExperience = (item: { id: string; title: string }) => {
    onAssign({
      id: item.id,
      type: "experience",
      source: "",
      title: item.title,
    });
  };

  const handleSelectMedia = (item: MediaItem) => {
    onAssign({
      id: item.id, // media_asset id — the screen points straight at it
      // Files tab is filtered to just video/image, but Recently Opened
      // surfaces whatever kind was actually pushed — anything else
      // (document/presentation/sheet/word/youtube/drive/link) is wire-typed
      // "html" once it reaches a screen (see mediaAssetToWsContent), so tag
      // it the same way here rather than lying that it's a video/image.
      type: item.type === "video" || item.type === "image" ? item.type : "html",
      source: item.url,
      title: item.name,
    });
    // The server records this push (setScreenMedia → recordScreenMediaPush),
    // so the "Recently Opened" tab will pick it up next time it's opened —
    // no client-side bookkeeping needed here.
  };

  const filteredExperiences = experiences.filter((exp) =>
    exp.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Already searched and type-filtered by the API.
  const filteredMedia = mediaItems;

  const filteredRecentItems = recentItems.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleSelectRecent = (item: RecentContentItem) => {
    if (item.kind === "experience") {
      handleSelectExperience({ id: item.id, title: item.name });
    } else {
      handleSelectMedia({
        id: item.id,
        name: item.name,
        type: item.type,
        url: item.url ?? "",
        size: item.size,
        date: item.date,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 select-none"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" />

      {/* Dialog Panel — ponytail: fixed h-[80vh] and max-w-5xl width prevents modal layout jumps on tab switch/filtering */}
      <div
        className="relative w-full max-w-5xl bg-white dark:bg-zinc-950 border border-border rounded-t-3xl md:rounded-3xl p-6 shadow-2xl flex flex-col h-[80vh] overflow-hidden transition-all transform scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
              Assign Content
            </p>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">
              {screenName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Selection & Search Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          {/* Tab Selector Buttons */}
          <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-full w-full sm:w-fit">
            <button
              onClick={() => {
                setActiveTab("experiences");
                setSearchQuery("");
              }}
              className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-normal rounded-full uppercase tracking-wider transition-all duration-200 ${
                activeTab === "experiences"
                  ? "btn-active"
                  : "btn-surface"
              }`}
            >
              Portfolio
            </button>
            <button
              onClick={() => {
                setActiveTab("files");
                setSearchQuery("");
              }}
              className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-normal rounded-full uppercase tracking-wider transition-all duration-200 ${
                activeTab === "files"
                  ? "btn-active"
                  : "btn-surface"
              }`}
            >
              Files (Media)
            </button>
            <button
              onClick={() => {
                setActiveTab("recent");
                setSearchQuery("");
              }}
              className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-normal rounded-full uppercase tracking-wider transition-all duration-200 ${
                activeTab === "recent"
                  ? "btn-active"
                  : "btn-surface"
              }`}
            >
              Recently Opened
            </button>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === "experiences"
                  ? "Search portfolio..."
                  : activeTab === "recent"
                    ? "Search recently opened..."
                    : "Search files..."
              }
              className="w-full h-9 pl-9 pr-4 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:bg-white dark:focus:bg-zinc-905 focus:border-zinc-300 dark:focus:border-zinc-750 transition-all text-xs outline-none text-zinc-800 dark:text-zinc-200"
            />
          </div>
        </div>

        {/* Dynamic List Content Panel */}
        <div className="flex-1 overflow-y-auto pr-1">
          {activeTab === "experiences" ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filteredExperiences.length === 0 ? (
                <p className="col-span-1 sm:col-span-3 md:col-span-4 text-center text-xs text-zinc-400 dark:text-zinc-600 py-12">
                  No experiences found matching "{searchQuery}"
                </p>
              ) : (
                filteredExperiences.map((item) => {
                  const isActive = currentContentLabel === item.title;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelectExperience(item)}
                      className={`relative flex flex-col items-start justify-end rounded-2xl border p-4 h-24 transition-all duration-200 text-left overflow-hidden group
                        ${
                          isActive
                            ? "border-border bg-zinc-100 dark:bg-zinc-800/80 shadow-md"
                            : "border-border bg-zinc-50/50 dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-850/50"
                        }`}
                    >
                      <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 transition-colors group-hover:text-zinc-500">
                        Portfolio
                      </span>
                      <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 leading-tight truncate w-full">
                        {item.title}
                      </span>
                      {isActive && (
                        <div className="absolute top-3 right-3 p-1 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
                          <Check className="h-3 w-3 shrink-0" />
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          ) : activeTab === "files" ? (
            /* Media Files Tab */
            <div className="w-full">
              {loadingMedia ? (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-400 gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                  <p className="text-xs">Loading media assets...</p>
                </div>
              ) : filteredMedia.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <p className="text-xs text-zinc-400 dark:text-zinc-600">
                    {searchQuery
                      ? `No media items match "${searchQuery}"`
                      : "No image or video files available in the media library."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {filteredMedia.map((media) => (
                    <MediaCard
                      key={media.id}
                      media={media}
                      isActive={currentContentLabel === media.name}
                      isDefault={currentDefaultMediaAssetId === media.id}
                      onSelect={() => handleSelectMedia(media)}
                      onSetDefault={onSetDefault}
                    />
                  ))}
                </div>
              )}
              {/* Sentinel: the next page loads when this scrolls into view. */}
              {!loadingMedia && mediaCursor && (
                <div
                  ref={mediaSentinelRef}
                  className="flex justify-center py-4"
                >
                  {loadingMoreMedia && (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Recently Opened Tab — up to 5 pieces of content (media or
               experience) most recently pushed to this screen (server-capped) */
            <div className="w-full">
              {loadingRecentItems ? (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-400 gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                  <p className="text-xs">Loading recently opened...</p>
                </div>
              ) : filteredRecentItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <p className="text-xs text-zinc-400 dark:text-zinc-600">
                    {searchQuery
                      ? `No recently opened content matches "${searchQuery}"`
                      : "Nothing has been pushed to this screen yet."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {filteredRecentItems.map((item) =>
                    item.kind === "experience" ? (
                      <ExperienceRecentCard
                        key={`experience:${item.id}`}
                        item={item}
                        isActive={currentContentLabel === item.name}
                        onSelect={() => handleSelectRecent(item)}
                      />
                    ) : (
                      <MediaCard
                        key={`media:${item.id}`}
                        media={{
                          id: item.id,
                          name: item.name,
                          type: item.type,
                          url: item.url ?? "",
                          size: item.size,
                          date: item.date,
                        }}
                        isActive={currentContentLabel === item.name}
                        isDefault={currentDefaultMediaAssetId === item.id}
                        onSelect={() => handleSelectRecent(item)}
                        onSetDefault={onSetDefault}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
