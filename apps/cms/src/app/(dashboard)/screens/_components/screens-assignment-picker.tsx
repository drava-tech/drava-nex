"use client";

import { useState, useEffect } from "react";
import { X, Check, Search, Image as ImageIcon, Video, Loader2 } from "lucide-react";
import type { WsContent } from "@platform/types";

interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
  size: string;
  date: string;
}

interface ScreenAssignmentPickerProps {
  screenName: string;
  currentContentLabel?: string;
  experiences: { id: string; title: string }[];
  onAssign: (content: WsContent) => void;
  onClose: () => void;
}

export function ScreenAssignmentPicker({
  screenName,
  currentContentLabel,
  experiences,
  onAssign,
  onClose,
}: ScreenAssignmentPickerProps) {
  const [activeTab, setActiveTab] = useState<"experiences" | "files">("experiences");
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  useEffect(() => {
    if (activeTab === "files" && mediaItems.length === 0) {
      setLoadingMedia(true);
      fetch("/api/media")
        .then((res) => res.json())
        .then((data) => {
          // Only show video and image files for screen display
          const files = (data.media || []).filter(
            (item: any) => item.type === "image" || item.type === "video"
          );
          setMediaItems(files);
        })
        .catch((err) => console.error("Failed to load media in picker:", err))
        .finally(() => setLoadingMedia(false));
    }
  }, [activeTab, mediaItems.length]);

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
      id: "", // Will be resolved dynamically on the server
      type: item.type as "video" | "image",
      source: item.url,
      title: item.name,
    });
  };

  const filteredExperiences = experiences.filter((exp) =>
    exp.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredMedia = mediaItems.filter((media) =>
    media.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 select-none"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" />

      {/* Dialog Panel */}
      <div
        className="relative w-full max-w-3xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-3xl md:rounded-3xl p-6 shadow-2xl flex flex-col max-h-[85vh] md:max-h-[80vh] overflow-hidden transition-all transform scale-100"
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
              className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-semibold rounded-full uppercase tracking-wider transition-all duration-200 ${
                activeTab === "experiences"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-350"
              }`}
            >
              Experiences
            </button>
            <button
              onClick={() => {
                setActiveTab("files");
                setSearchQuery("");
              }}
              className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-semibold rounded-full uppercase tracking-wider transition-all duration-200 ${
                activeTab === "files"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-350"
              }`}
            >
              Files (Media)
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
                  ? "Search experiences..."
                  : "Search files..."
              }
              className="w-full h-9 pl-9 pr-4 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:bg-white dark:focus:bg-zinc-905 focus:border-zinc-300 dark:focus:border-zinc-750 transition-all text-xs outline-none text-zinc-800 dark:text-zinc-200"
            />
          </div>
        </div>

        {/* Dynamic List Content Panel */}
        <div className="flex-1 overflow-y-auto pr-1">
          {activeTab === "experiences" ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {filteredExperiences.length === 0 ? (
                <p className="col-span-3 text-center text-xs text-zinc-400 dark:text-zinc-600 py-12">
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
                            ? "border-zinc-900 dark:border-zinc-300 bg-zinc-100 dark:bg-zinc-800/80 shadow-md"
                            : "border-zinc-200 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-850/50"
                        }`}
                    >
                      <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 transition-colors group-hover:text-zinc-500">
                        Experience
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
          ) : (
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {filteredMedia.map((media) => {
                    const isActive = currentContentLabel === media.name;
                    return (
                      <button
                        key={media.id}
                        onClick={() => handleSelectMedia(media)}
                        className={`relative flex flex-col bg-zinc-50 dark:bg-[#111] rounded-2xl border transition-all duration-300 overflow-hidden text-left group
                          ${
                            isActive
                              ? "border-zinc-900 dark:border-zinc-300 bg-zinc-100 dark:bg-zinc-900 ring-2 ring-zinc-900/10 dark:ring-zinc-100/10 shadow-lg"
                              : "border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/25 hover:shadow-md"
                          }`}
                      >
                        {/* Thumbnail preview */}
                        <div className="aspect-[16/10] w-full bg-zinc-100 dark:bg-zinc-800/40 relative overflow-hidden flex items-center justify-center border-b border-zinc-200/50 dark:border-white/5">
                          {media.type === "video" ? (
                            <video
                              src={media.url}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                            />
                          ) : (
                            <img
                              src={media.url}
                              alt={media.name}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                              loading="lazy"
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
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

