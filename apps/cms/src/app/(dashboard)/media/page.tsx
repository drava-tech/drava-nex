"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Upload,
  Folder,
  Image as ImageIcon,
  Video,
  FileText,
  FileSpreadsheet,
  Presentation,
  Link2,
  Globe,
  HardDrive,
  Play,
  MoreVertical,
  Trash2,
  Download,
  Copy,
  Check,
  Loader2,
  CheckSquare,
  X,
} from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@platform/ui";
import { isLinkMediaType, parseYouTubeId } from "@platform/types";
import { MediaPreviewModal, type MediaItem } from "./_components/media-preview-modal";
import { AddLinkDialog } from "./_components/add-link-dialog";

const CATEGORIES = [
  { id: 'all', label: 'All Media', icon: Folder },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'videos', label: 'Videos', icon: Video },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'sheets', label: 'Spreadsheets', icon: FileSpreadsheet },
  { id: 'presentations', label: 'Presentations', icon: Presentation },
  { id: 'links', label: 'Links', icon: Link2 },
];

/** Small icon for a media kind, used in the type badge on each card. */
function TypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon =
    type === 'video' ? Video
    : type === 'image' ? ImageIcon
    : type === 'document' ? FileText
    : type === 'word' ? FileText
    : type === 'sheet' ? FileSpreadsheet
    : type === 'presentation' ? Presentation
    : type === 'youtube' ? Play
    : type === 'drive' ? HardDrive
    : Globe;
  return <Icon className={className} />;
}

export default function MediaPage() {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMedia = async () => {
    try {
      const res = await fetch("/api/media");
      if (res.ok) {
        const data = await res.json();
        setMediaItems(data.media || []);
      }
    } catch (err) {
      console.error("Failed to load media:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, []);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.media) {
          setMediaItems((prev) => [data.media, ...prev]);
        }
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/media?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMediaItems((prev) => prev.filter((item) => item.id !== id));
        setPreviewItem((current) => (current?.id === id ? null : current));
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === filteredItems.length ? new Set() : new Set(filteredItems.map((item) => item.id))
    );
  };

  const handleExitSelecting = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected item${selectedIds.size === 1 ? "" : "s"}? This can't be undone.`)) {
      return;
    }
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const results = await Promise.all(
        ids.map((id) => fetch(`/api/media?id=${id}`, { method: "DELETE" }).then((res) => ({ id, ok: res.ok })))
      );
      const deletedIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
      setMediaItems((prev) => prev.filter((item) => !deletedIds.has(item.id)));
      setPreviewItem((current) => (current && deletedIds.has(current.id) ? null : current));
      setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => !deletedIds.has(id))));
    } catch (err) {
      console.error("Bulk delete failed:", err);
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleCopyLink = (item: MediaItem) => {
    const absoluteUrl = item.url.startsWith("http")
      ? item.url
      : `${window.location.protocol}//${window.location.host}${item.url}`;

    navigator.clipboard.writeText(absoluteUrl);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredItems = mediaItems.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (activeCategory === "all") return matchesSearch;
    if (activeCategory === "images") return item.type === "image" && matchesSearch;
    if (activeCategory === "videos") return item.type === "video" && matchesSearch;
    if (activeCategory === "documents") return (item.type === "document" || item.type === "word") && matchesSearch;
    if (activeCategory === "sheets") return item.type === "sheet" && matchesSearch;
    if (activeCategory === "presentations") return item.type === "presentation" && matchesSearch;
    if (activeCategory === "links") return isLinkMediaType(item.type) && matchesSearch;
    return matchesSearch;
  });

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-[#0a0a0a] min-h-[calc(100vh-4rem)] select-none">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,video/*,application/pdf,.xlsx,.csv,.pptx,.docx"
      />

      {/* Top Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 lg:px-8 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] sticky top-0 z-20">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Media Library</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Manage and organize your assets</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search media..."
              className="h-10 pl-9 pr-4 w-full sm:w-64 rounded-full bg-zinc-100 dark:bg-white/5 border-transparent focus:bg-white dark:focus:bg-[#111] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-sm outline-none dark:text-white"
            />
          </div>
          <button
            onClick={() => (selecting ? handleExitSelecting() : setSelecting(true))}
            className={`h-10 px-5 inline-flex items-center justify-center gap-2 rounded-full border text-sm font-medium transition-all active:scale-95 ${
              selecting
                ? "border-blue-600 bg-blue-50 text-blue-600 dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-400"
                : "border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
            }`}
          >
            <CheckSquare className="h-4 w-4" />
            {selecting ? "Cancel" : "Select"}
          </button>
          <button
            onClick={() => setShowLinkDialog(true)}
            className="h-10 px-5 inline-flex items-center justify-center gap-2 rounded-full border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 text-sm font-medium transition-all hover:bg-zinc-100 dark:hover:bg-white/5 active:scale-95"
          >
            <Link2 className="h-4 w-4" />
            Add Link
          </button>
          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className="h-10 px-5 inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-blue-600/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar / Categories */}
        <div className="hidden md:flex flex-col w-64 p-6 border-r border-zinc-200 dark:border-white/10 bg-white/50 dark:bg-[#0a0a0a]/50">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3 px-3">Library</h3>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeCategory === cat.id
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                <cat.icon className={`h-4 w-4 ${activeCategory === cat.id ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
          {/* Controls Bar */}
          <div className="flex items-center justify-between mb-6 gap-4">
            {selecting ? (
              <>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    {selectedIds.size} selected
                  </p>
                  <button
                    onClick={handleSelectAll}
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {selectedIds.size === filteredItems.length && filteredItems.length > 0 ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBulkDelete}
                    disabled={selectedIds.size === 0 || bulkDeleting}
                    className="flex items-center gap-1.5 h-9 px-4 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {bulkDeleting ? "Deleting…" : `Delete${selectedIds.size ? ` (${selectedIds.size})` : ""}`}
                  </button>
                  <button
                    onClick={handleExitSelecting}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-full text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" /> Cancel
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Showing {activeCategory === 'all' ? 'All Files' : activeCategory} <span className="text-zinc-400 dark:text-zinc-500">({filteredItems.length})</span>
              </p>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24 text-zinc-400">
              Loading Media Assets...
            </div>
          ) : filteredItems.length === 0 && !uploading ? (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-2">
              <Folder className="h-8 w-8 text-zinc-400 opacity-60" />
              <p className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">No assets found</p>
              <p className="text-xs text-zinc-400">Upload a file or add a link to get started.</p>
            </div>
          ) : (
            /* Media Grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 lg:gap-6">
              {uploading && (
                <div className="flex flex-col bg-zinc-50 dark:bg-zinc-900/40 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 animate-pulse overflow-hidden">
                  <div className="aspect-video w-full bg-zinc-100/50 dark:bg-zinc-800/30 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  </div>
                  <div className="p-4 flex flex-col gap-1">
                    <h4 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 truncate">
                      Uploading asset...
                    </h4>
                    <p className="text-xs text-zinc-300 dark:text-zinc-655 font-semibold">Please wait</p>
                  </div>
                </div>
              )}
              {filteredItems.map((media) => {
                const isSelected = selectedIds.has(media.id);
                return (
                <div
                  key={media.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => (selecting ? toggleSelected(media.id) : setPreviewItem(media))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (selecting) toggleSelected(media.id);
                      else setPreviewItem(media);
                    }
                  }}
                  className={`group relative flex flex-col bg-white dark:bg-[#111] rounded-2xl border hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isSelected
                      ? "border-blue-500 ring-2 ring-blue-500/40"
                      : "border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20"
                  }`}
                >
                  {selecting ? (
                    /* Selection checkbox — its own click target so it doesn't
                       double-toggle via the card's own onClick. */
                    <div
                      className="absolute top-3 left-3 z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelected(media.id);
                      }}
                    >
                      <div
                        className={`flex items-center justify-center w-6 h-6 rounded-md border-2 backdrop-blur-md transition-colors ${
                          isSelected
                            ? "bg-blue-600 border-blue-600"
                            : "bg-black/30 border-white/70 hover:border-white"
                        }`}
                      >
                        {isSelected && <Check className="w-4 h-4 text-white" />}
                      </div>
                    </div>
                  ) : (
                    /* Dropdown Menu — its own click target, so it doesn't open the preview */
                    <div
                      className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center justify-center w-8 h-8 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60 transition-colors">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem
                            className="cursor-pointer gap-2"
                            onClick={() => handleCopyLink(media)}
                          >
                            {copiedId === media.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            {copiedId === media.id ? "Copied!" : "Copy Link"}
                          </DropdownMenuItem>
                          {!isLinkMediaType(media.type) && (
                            <DropdownMenuItem className="cursor-pointer gap-2" asChild>
                              <a href={media.url} download={media.name}>
                                <Download className="w-4 h-4" /> Download
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="cursor-pointer gap-2 text-red-600 focus:text-red-600"
                            onClick={() => handleDelete(media.id)}
                          >
                            <Trash2 className="w-4 h-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {/* Thumbnail Area */}
                  <div className="aspect-video w-full overflow-hidden rounded-t-2xl bg-zinc-100 dark:bg-zinc-800/50 relative">
                    <MediaThumbnail media={media} />
                    {/* Type Badge */}
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md text-white text-[10px] font-medium tracking-wide uppercase">
                      <TypeIcon type={media.type} className="w-3 h-3" />
                      {media.type}
                    </div>
                  </div>

                  {/* Metadata Area */}
                  <div className="p-4 flex flex-col gap-1">
                    <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate" title={media.name}>
                      {media.name}
                    </h4>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{media.size}</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">{media.date}</p>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {previewItem && (
        <MediaPreviewModal media={previewItem} onClose={() => setPreviewItem(null)} />
      )}

      {showLinkDialog && (
        <AddLinkDialog
          onClose={() => setShowLinkDialog(false)}
          // Pending-save (same as a Browser-tool push) — open its preview/push
          // popup right away instead of adding a tile to the grid; it only
          // shows up in the library if explicitly kept via "Save link" there.
          onAdded={(media) => {
            setShowLinkDialog(false);
            setPreviewItem(media);
          }}
        />
      )}
    </div>
  );
}

/** Card thumbnail: real media previews where we have one, a type glyph otherwise. */
function MediaThumbnail({ media }: { media: MediaItem }) {
  if (media.type === 'video') {
    return (
      <video
        src={media.url}
        className="w-full h-full object-cover"
        muted
        playsInline
        loop
        onMouseOver={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
        onMouseOut={(e) => (e.target as HTMLVideoElement).pause()}
      />
    );
  }

  if (media.type === 'image') {
    return (
      <img
        src={media.url}
        alt={media.name}
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        loading="lazy"
      />
    );
  }

  if (media.type === 'youtube') {
    const videoId = parseYouTubeId(media.url);
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Play className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
        {videoId && (
          // YouTube's own thumbnail, layered over the glyph — if the screen has
          // no internet the image just fails and the glyph shows through.
          <img
            src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
            alt={media.name}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <TypeIcon type={media.type} className="w-16 h-16 text-zinc-300 dark:text-zinc-600" />
    </div>
  );
}
