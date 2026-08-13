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
  MonitorPlay,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Mail,
  CalendarRange,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  cn,
} from "@platform/ui";
import { isLinkMediaType, parseYouTubeId } from "@platform/types";
import { MediaPreviewModal, type MediaItem } from "./_components/media-preview-modal";
import { MediaQueuePushModal } from "./_components/media-queue-push-modal";

// "All Media" isn't a real filterable category — it's the zero-selection
// state (nothing checked in the dropdown = show everything).
const CATEGORIES = [
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'videos', label: 'Videos', icon: Video },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'sheets', label: 'Spreadsheets', icon: FileSpreadsheet },
  { id: 'presentations', label: 'Presentations', icon: Presentation },
  { id: 'links', label: 'Links', icon: Link2 },
];

/** Does this media item belong to the given filter category? */
function matchesCategory(item: MediaItem, categoryId: string): boolean {
  switch (categoryId) {
    case 'images': return item.type === 'image';
    case 'videos': return item.type === 'video';
    case 'documents': return item.type === 'document' || item.type === 'word';
    case 'sheets': return item.type === 'sheet';
    case 'presentations': return item.type === 'presentation';
    case 'links': return isLinkMediaType(item.type);
    default: return false;
  }
}

// Same "upload" | "email" | "link" values as SOURCE_LABELS/SourceBadge below.
const SOURCES = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'link', label: 'Link', icon: Link2 },
];

/** `from`/`to` are `<input type="date">` values ("YYYY-MM-DD"), directly
 * comparable against the leading 10 chars of an ISO `createdAt` string.
 * Either bound may be empty for an open-ended range; an item with no
 * createdAt (shouldn't happen post-backfill, but be safe) is never excluded. */
function matchesDateRange(item: MediaItem, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!item.createdAt) return true;
  const itemDate = item.createdAt.slice(0, 10);
  if (from && itemDate < from) return false;
  if (to && itemDate > to) return false;
  return true;
}

/** Small icon for a media kind, used in the type badge on each card/row. */
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

const TYPE_LABELS: Record<string, string> = {
  image: "Image",
  video: "Video",
  document: "PDF",
  word: "Word doc",
  sheet: "Spreadsheet",
  presentation: "Presentation",
  youtube: "YouTube",
  drive: "Google Drive",
  link: "Web page",
};

/** Where an asset came from — see packages/db/src/schema/media.ts. */
const SOURCE_LABELS: Record<string, string> = {
  upload: "Upload",
  email: "Email",
  link: "Link",
};

const SOURCE_BADGE_STYLES: Record<string, string> = {
  upload: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  email: "bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400",
  link: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
};

function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
        SOURCE_BADGE_STYLES[source] ?? "bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-400"
      )}
    >
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function MediaPage() {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  // Empty set = "All Media" (no filter applied). Multiple categories checked
  // at once is an OR — an item matching ANY selected category is shown.
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  // Same OR-within-the-filter, AND-across-filters shape as selectedCategories.
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0] ?? 10);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [queueItems, setQueueItems] = useState<MediaItem[] | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  // On-demand Gmail ingest — pulls the last 2 days of attachments/links
  // straight into this same media_asset table, so a plain refetch is all
  // that's needed to show the new items.
  const handleLoadFromEmail = async () => {
    setLoadingInbox(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/media/gmail/load", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Could not load email");
      await fetchMedia();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load email");
    } finally {
      setLoadingInbox(false);
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

  // Selection order (Set insertion order) IS the queue order — the first
  // item clicked plays first.
  const handlePushSelected = () => {
    const ordered = Array.from(selectedIds)
      .map((id) => mediaItems.find((item) => item.id === id))
      .filter((item): item is MediaItem => Boolean(item));
    if (ordered.length > 0) setQueueItems(ordered);
  };

  const handleCopyLink = (item: MediaItem) => {
    const absoluteUrl = item.url.startsWith("http")
      ? item.url
      : `${window.location.protocol}//${window.location.host}${item.url}`;

    navigator.clipboard.writeText(absoluteUrl);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSource = (id: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredItems = mediaItems.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (selectedCategories.size > 0 && !Array.from(selectedCategories).some((cat) => matchesCategory(item, cat))) {
      return false;
    }
    if (selectedSources.size > 0 && !(item.source && selectedSources.has(item.source))) {
      return false;
    }
    if (!matchesDateRange(item, dateFrom, dateTo)) return false;
    return true;
  });

  // Any filter/search change can shrink the result set out from under the
  // current page — snap back to page 1 rather than showing an empty page.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategories, selectedSources, dateFrom, dateTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const paginatedItems = filteredItems.slice(pageStart, pageStart + pageSize);

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
      <div className="flex flex-col gap-4 p-4 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] sticky top-0 z-20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Media Library</h1>
            {/* <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Manage and organize your assets</p> */}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => (selecting ? handleExitSelecting() : setSelecting(true))}
              className={`h-10 px-4 inline-flex items-center justify-center gap-2 rounded-full border text-sm font-medium transition-all active:scale-95 ${selecting
                  ? "border-blue-600 bg-blue-50 text-blue-600 dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-400"
                  : "border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
                }`}
            >
              <CheckSquare className="h-4 w-4" />
              {selecting ? "Cancel" : "Select"}
            </button>
            <button
              onClick={handleLoadFromEmail}
              disabled={loadingInbox}
              title="Load last 2 days from email"
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-full border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 text-sm font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-4 w-4 shrink-0 ${loadingInbox ? "animate-spin" : ""}`} />
              {loadingInbox ? "Loading…" : "Load Email"}
            </button>
            <button
              onClick={handleUploadClick}
              disabled={uploading}
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-blue-600/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
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

        {loadError && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">{loadError}</p>
        )}

        {/* Search + category filter dropdown (multi-select) */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <div className="relative group shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search media..."
              className="h-9 pl-9 pr-4 w-48 sm:w-64 rounded-full bg-zinc-100 dark:bg-white/5 border-transparent focus:bg-white dark:focus:bg-[#111] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-sm outline-none dark:text-white"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`shrink-0 flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${selectedCategories.size > 0
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
              >
                <Folder className={`h-3.5 w-3.5 ${selectedCategories.size > 0 ? "text-white" : "text-zinc-400"}`} />
                {selectedCategories.size === 0
                  ? "All Media"
                  : selectedCategories.size === 1
                    ? CATEGORIES.find((c) => selectedCategories.has(c.id))?.label
                    : `${selectedCategories.size} filters`}
                <ChevronDown className={`h-3.5 w-3.5 ${selectedCategories.size > 0 ? "text-white" : "text-zinc-400"}`} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {CATEGORIES.map((cat) => (
                <DropdownMenuCheckboxItem
                  key={cat.id}
                  checked={selectedCategories.has(cat.id)}
                  onCheckedChange={() => toggleCategory(cat.id)}
                  onSelect={(e) => e.preventDefault()}
                  className="gap-2"
                >
                  <cat.icon className="h-3.5 w-3.5 text-zinc-400" />
                  {cat.label}
                </DropdownMenuCheckboxItem>
              ))}
              {selectedCategories.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-zinc-500 dark:text-zinc-400"
                    onClick={() => setSelectedCategories(new Set())}
                  >
                    Clear filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Source filter — same multi-select checkbox pattern as Type above. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`shrink-0 flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${selectedSources.size > 0
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
              >
                <Mail className={`h-3.5 w-3.5 ${selectedSources.size > 0 ? "text-white" : "text-zinc-400"}`} />
                {selectedSources.size === 0
                  ? "Source"
                  : selectedSources.size === 1
                    ? SOURCES.find((s) => selectedSources.has(s.id))?.label
                    : `${selectedSources.size} sources`}
                <ChevronDown className={`h-3.5 w-3.5 ${selectedSources.size > 0 ? "text-white" : "text-zinc-400"}`} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {SOURCES.map((src) => (
                <DropdownMenuCheckboxItem
                  key={src.id}
                  checked={selectedSources.has(src.id)}
                  onCheckedChange={() => toggleSource(src.id)}
                  onSelect={(e) => e.preventDefault()}
                  className="gap-2"
                >
                  <src.icon className="h-3.5 w-3.5 text-zinc-400" />
                  {src.label}
                </DropdownMenuCheckboxItem>
              ))}
              {selectedSources.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-zinc-500 dark:text-zinc-400"
                    onClick={() => setSelectedSources(new Set())}
                  >
                    Clear filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Date range filter — two native date inputs; onSelect prevented
              on the wrapping item isn't needed since these aren't menu items,
              but keeping the menu open while typing/picking matters, which
              plain <input>s inside DropdownMenuContent already do by default. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`shrink-0 flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${dateFrom || dateTo
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
              >
                <CalendarRange className={`h-3.5 w-3.5 ${dateFrom || dateTo ? "text-white" : "text-zinc-400"}`} />
                {!dateFrom && !dateTo
                  ? "Date Range"
                  : dateFrom && dateTo
                    ? `${dateFrom} → ${dateTo}`
                    : dateFrom
                      ? `From ${dateFrom}`
                      : `Until ${dateTo}`}
                <ChevronDown className={`h-3.5 w-3.5 ${dateFrom || dateTo ? "text-white" : "text-zinc-400"}`} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 p-3">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">From</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    max={dateTo || undefined}
                    className="h-9 px-2 rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#111] text-sm outline-none focus:border-blue-500 dark:text-white"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">To</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    min={dateFrom || undefined}
                    className="h-9 px-2 rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#111] text-sm outline-none focus:border-blue-500 dark:text-white"
                  />
                </div>
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => { setDateFrom(""); setDateTo(""); }}
                    className="self-start text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:underline"
                  >
                    Clear dates
                  </button>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 overflow-y-auto">
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
                  onClick={handlePushSelected}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <MonitorPlay className="h-3.5 w-3.5" />
                  {selectedIds.size ? `Push selected (${selectedIds.size})` : "Push selected"}
                </button>
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
              Showing {selectedCategories.size === 0 ? 'All Files' : Array.from(selectedCategories).map((id) => CATEGORIES.find((c) => c.id === id)?.label).join(', ')} <span className="text-zinc-400 dark:text-zinc-500">({filteredItems.length})</span>
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
          /* Media Table */
          <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#111] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {selecting && <TableHead className="w-10" />}
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uploading && (
                  <TableRow>
                    <TableCell colSpan={selecting ? 7 : 6}>
                      <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        Uploading asset…
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {paginatedItems.map((media) => {
                  const isSelected = selectedIds.has(media.id);
                  return (
                    <TableRow
                      key={media.id}
                      onClick={() => (selecting ? toggleSelected(media.id) : setPreviewItem(media))}
                      className={cn(
                        "cursor-pointer",
                        isSelected && "bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                      )}
                    >
                      {selecting && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleSelected(media.id)}
                            aria-label={isSelected ? `Deselect ${media.name}` : `Select ${media.name}`}
                            className={cn(
                              "flex items-center justify-center w-5 h-5 rounded-md border-2 transition-colors",
                              isSelected
                                ? "bg-blue-600 border-blue-600"
                                : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
                            )}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                          </button>
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800/50">
                            <MediaThumbnail media={media} compact />
                          </div>
                          <span
                            className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[280px]"
                            title={media.name}
                          >
                            {media.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          <TypeIcon type={media.type} className="w-3.5 h-3.5" />
                          {TYPE_LABELS[media.type] ?? media.type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <SourceBadge source={media.source} />
                      </TableCell>
                      <TableCell className="text-zinc-500 dark:text-zinc-400">{media.size}</TableCell>
                      <TableCell className="text-zinc-500 dark:text-zinc-400">{media.date}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="inline-flex items-center justify-center w-8 h-8 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-zinc-100 transition-colors">
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {!loading && filteredItems.length > 0 && (
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {pageStart + 1}–{Math.min(pageStart + pageSize, filteredItems.length)} of {filteredItems.length}
              </p>
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="h-7 pl-2 pr-6 rounded-lg bg-zinc-100 dark:bg-white/5 border-transparent text-xs font-medium text-zinc-700 dark:text-zinc-300 outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
            </div>
            {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                aria-label="Previous page"
                className="inline-flex items-center justify-center w-8 h-8 rounded-full text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 px-2">
                Page {safePage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                aria-label="Next page"
                className="inline-flex items-center justify-center w-8 h-8 rounded-full text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            )}
          </div>
        )}
      </div>

      {previewItem && (
        <MediaPreviewModal media={previewItem} onClose={() => setPreviewItem(null)} />
      )}

      {queueItems && (
        <MediaQueuePushModal items={queueItems} onClose={() => setQueueItems(null)} />
      )}
    </div>
  );
}

/**
 * Media preview: real thumbnails where we have one, a type glyph otherwise.
 * `compact` shrinks the fallback glyph for the table row's small avatar cell
 * (vs. the large aspect-video preview in MediaPreviewModal).
 */
function MediaThumbnail({ media, compact = false }: { media: MediaItem; compact?: boolean }) {
  if (media.type === 'video') {
    return (
      <video
        src={media.url}
        className="w-full h-full object-cover"
        muted
        playsInline
        loop
        onMouseOver={(e) => (e.target as HTMLVideoElement).play().catch(() => { })}
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
        <Play className={compact ? "w-4 h-4 text-zinc-300 dark:text-zinc-600" : "w-12 h-12 text-zinc-300 dark:text-zinc-600"} />
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
      <TypeIcon type={media.type} className={compact ? "w-4 h-4 text-zinc-300 dark:text-zinc-600" : "w-16 h-16 text-zinc-300 dark:text-zinc-600"} />
    </div>
  );
}
