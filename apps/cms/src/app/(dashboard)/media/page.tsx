"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { getMediaInbox } from "@/actions/media-inbox-actions";
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
  cn,
} from "@platform/ui";
import { parseYouTubeId } from "@platform/types";
import { isLinkMediaType, mediaThumbnailSrc, typesForCategories } from "@/lib/media-tiles";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { DateRangeCalendar } from "@/components/date-range-calendar";
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

// Same "upload" | "email" | "link" values as SOURCE_LABELS/SourceBadge below.
const SOURCES = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'link', label: 'Link', icon: Link2 },
];

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
  upload: "bg-red-50 text-primary dark:bg-primary/10 dark:text-red-400",
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
  // A User has a library of their own (see apps/api/src/routes/media.ts), so
  // their empty state says how to fill it.
  const { data: session } = useSession();
  const sessionUser = session?.user as { role?: string; email?: string } | undefined;
  const isUser = sessionUser?.role === "GUEST";
  const [inbox, setInbox] = useState<string | null>(null);
  useEffect(() => {
    if (isUser) getMediaInbox().then(setInbox).catch(() => setInbox(null));
  }, [isUser]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  /** Total matching the current filters, across all pages — the paging controls
   *  need it, and it can no longer be read off mediaItems.length now that only
   *  one page is in memory. */
  const [total, setTotal] = useState(0);
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

  // Server-side search, so a large library isn't downloaded on every keystroke.
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  /** Guards against out-of-order responses: a slow early request must not
   *  overwrite the results of a later, narrower one. */
  const requestSeqRef = useRef(0);

  /**
   * Every filter is applied by the API now, not after the fetch.
   *
   * The paging controls below were always here, but they used to slice an
   * array that had already been fully downloaded — so page size changed what
   * was drawn and nothing else. Filtering client-side is also incompatible with
   * real paging: it would filter one page and leave the rest of the matches
   * unfetched, so pages would come back short or empty.
   */
  const mediaQuery = useCallback(() => {
    const params = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(pageSize),
    });
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    // Category chips are an OR, and each expands to the media_asset.type values
    // it covers (see typesForCategories in @platform/types).
    const types = typesForCategories([...selectedCategories]);
    if (types.length > 0) params.set("types", types.join(","));
    if (selectedSources.size > 0) params.set("sources", [...selectedSources].join(","));
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  }, [
    currentPage,
    pageSize,
    debouncedSearch,
    selectedCategories,
    selectedSources,
    dateFrom,
    dateTo,
  ]);

  const fetchMedia = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      const res = await fetch(`/api/media?${mediaQuery().toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (seq !== requestSeqRef.current) return;
        setMediaItems(data.media || []);
        setTotal(typeof data.total === "number" ? data.total : (data.media?.length ?? 0));
      }
    } catch (err) {
      console.error("Failed to load media:", err);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [mediaQuery]);

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
    void fetchMedia();
  }, [fetchMedia]);

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
          // Optimistic insert so the new file appears immediately. `total` has
          // to move with it now that it comes from the server rather than from
          // mediaItems.length — otherwise the "1-20 of 189" label and the page
          // count sit one behind until the next fetch.
          setMediaItems((prev) => [data.media, ...prev]);
          setTotal((prev) => prev + 1);
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
        // Refetch rather than just splicing locally: with server-side paging
        // the page is now one short and `total` is stale, and dropping the last
        // row of the last page needs the page clamp to run. The refetch pulls
        // the next row up and corrects the count.
        void fetchMedia();
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

  // Scoped to the current page: with server-side paging the other pages aren't
  // in memory, and silently deleting rows the user never saw would be worse
  // than a select-all that means exactly what is on screen.
  const handleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === paginatedItems.length
        ? new Set()
        : new Set(paginatedItems.map((item) => item.id))
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
      // Same reason as the single delete above — refill the page and correct
      // `total` from the server.
      void fetchMedia();
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

  // Any filter/search change can shrink the result set out from under the
  // current page — snap back to page 1 rather than requesting an empty page.
  // Uses the debounced search so it fires once per pause, in step with the
  // request itself, rather than on every keystroke.
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedCategories, selectedSources, dateFrom, dateTo, pageSize]);

  // mediaItems IS the current page now — the server did the filtering and the
  // slicing, so there is nothing left to narrow here.
  const paginatedItems = mediaItems;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * pageSize;

  // Deleting the last item on the last page leaves currentPage past the end;
  // pull it back so the next request asks for a page that exists.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-transparent min-h-[calc(100vh-4rem)] select-none">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,video/*,application/pdf,.xlsx,.csv,.pptx,.docx"
      />

      {/* Top Header Section */}
      <div className="flex flex-col gap-4 p-4 border-b border-border sticky top-0 z-20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Media Library</h1>
            {/* <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Manage and organize your assets</p> */}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => (selecting ? handleExitSelecting() : setSelecting(true))}
              className={`h-10 px-4 inline-flex items-center justify-center gap-2 rounded-full border-0 text-sm font-normal transition-all active:scale-95 ${selecting
                  ? "btn-active"
                  : "btn-surface"
                }`}
            >
              <CheckSquare className="h-4 w-4" />
              {selecting ? "Cancel" : "Select"}
            </button>
            <button
              onClick={handleLoadFromEmail}
              disabled={loadingInbox}
              title="Load last 2 days from email"
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-full btn-surface text-sm font-normal transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-4 w-4 shrink-0 ${loadingInbox ? "animate-spin" : ""}`} />
              {loadingInbox ? "Loading…" : "Load Email"}
            </button>
            <button
              onClick={handleUploadClick}
              disabled={uploading}
              className={`h-10 px-4 inline-flex items-center justify-center gap-2 rounded-full btn-primary text-sm font-normal transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search media..."
              className="h-9 pl-9 pr-4 w-48 sm:w-64 rounded-full bg-zinc-100 dark:bg-white/5 border-transparent focus:bg-white dark:focus:bg-[#111] focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm outline-none dark:text-white"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`shrink-0 flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${selectedCategories.size > 0
                    ? "btn-active"
                    : "btn-surface"
                  }`}
              >
                <Folder className="h-3.5 w-3.5" />
                {selectedCategories.size === 0
                  ? "All Media"
                  : selectedCategories.size === 1
                    ? CATEGORIES.find((c) => selectedCategories.has(c.id))?.label
                    : `${selectedCategories.size} filters`}
                <ChevronDown className="h-3.5 w-3.5" />
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
                    ? "btn-active"
                    : "btn-surface"
                  }`}
              >
                <Mail className="h-3.5 w-3.5" />
                {selectedSources.size === 0
                  ? "Source"
                  : selectedSources.size === 1
                    ? SOURCES.find((s) => selectedSources.has(s.id))?.label
                    : `${selectedSources.size} sources`}
                <ChevronDown className="h-3.5 w-3.5" />
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
                    ? "btn-active"
                    : "btn-surface"
                  }`}
              >
                <CalendarRange className="h-3.5 w-3.5" />
                {!dateFrom && !dateTo
                  ? "Date Range"
                  : dateFrom && dateTo
                    ? `${dateFrom} → ${dateTo}`
                    : dateFrom
                      ? `From ${dateFrom}`
                      : `Until ${dateTo}`}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="p-3">
              <DateRangeCalendar
                from={dateFrom}
                to={dateTo}
                onChange={(from, to) => {
                  setDateFrom(from);
                  setDateTo(to);
                }}
              />
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
                  {selectedIds.size === paginatedItems.length && paginatedItems.length > 0 ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePushSelected}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-full btn-primary text-xs font-normal uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                  className="flex items-center gap-1.5 h-9 px-3 rounded-full btn-surface text-xs font-normal uppercase tracking-wider transition-colors"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Showing {selectedCategories.size === 0 ? 'All Files' : Array.from(selectedCategories).map((id) => CATEGORIES.find((c) => c.id === id)?.label).join(', ')} <span className="text-zinc-400 dark:text-zinc-500">({total})</span>
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-400">
            Loading Media Assets...
          </div>
        ) : total === 0 && !uploading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-2">
            <Folder className="h-8 w-8 text-zinc-400 opacity-60" />
            {isUser && !searchQuery && selectedCategories.size === 0 && selectedSources.size === 0 && !dateFrom && !dateTo ? (
              <>
                <p className="text-sm text-foreground">Your media library is empty</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  This is your own space: you see only what you add. Upload files or add a link above
                  {inbox ? (
                    <>
                      , or email attachments to <span className="text-foreground">{inbox}</span> from{" "}
                      <span className="text-foreground">{sessionUser?.email}</span> and press Load Email.
                    </>
                  ) : (
                    <>, or email them to Nex from {sessionUser?.email} and press Load Email.</>
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">No assets found</p>
                <p className="text-xs text-zinc-400">Upload a file or add a link to get started.</p>
              </>
            )}
          </div>
        ) : (
          /* Media Table */
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-sidebar text-left text-xs text-sidebar-foreground">
                <tr>
                  {selecting && <th className="w-10 px-4 py-3 font-medium" />}
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploading && (
                  <tr className="border-b last:border-0">
                    <td colSpan={selecting ? 7 : 6} className="px-4 py-3">
                      <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        Uploading asset…
                      </div>
                    </td>
                  </tr>
                )}
                {paginatedItems.map((media) => {
                  const isSelected = selectedIds.has(media.id);
                  return (
                    <tr
                      key={media.id}
                      onClick={() => (selecting ? toggleSelected(media.id) : setPreviewItem(media))}
                      className={cn(
                        "cursor-pointer border-b last:border-0 hover:bg-muted/30",
                        isSelected && "bg-red-50 dark:bg-primary/10 hover:bg-red-50 dark:hover:bg-primary/10"
                      )}
                    >
                      {selecting && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleSelected(media.id)}
                            aria-label={isSelected ? `Deselect ${media.name}` : `Select ${media.name}`}
                            className={cn(
                              "flex items-center justify-center w-5 h-5 rounded-md border-2 transition-colors",
                              isSelected
                                ? "bg-primary border-primary"
                                : "border-border hover:border-zinc-400 dark:hover:border-zinc-500"
                            )}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                          </button>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-sidebar">
                            <MediaThumbnail media={media} compact />
                          </div>
                          <span
                            className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[280px]"
                            title={media.name}
                          >
                            {media.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          <TypeIcon type={media.type} className="w-3.5 h-3.5 dark:text-white" />
                          {TYPE_LABELS[media.type] ?? media.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <SourceBadge source={media.source} />
                      </td>
                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{media.size}</td>
                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{media.date}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > 0 && (
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {total === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + pageSize, total)} of {total}
              </p>
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="h-7 pl-2 pr-6 rounded-lg bg-zinc-100 dark:bg-white/5 border-transparent text-xs font-medium text-zinc-700 dark:text-zinc-300 outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
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
      // preload="metadata": without it the browser buffers megabytes of every
      // video in the grid just to draw a tile — one Media page view measured
      // 26.5 MB, of which 22 MB was video nobody asked to play. These uploads
      // are faststart (moov at byte 0), so "metadata" still paints the first
      // frame as the thumbnail while fetching only the header.
      <video
        src={media.url}
        className="w-full h-full object-cover"
        preload="metadata"
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
        // The derived tile, not the original: these grid cells are ~200px but
        // used to load the full upload (measured: 15.8 MB for one page of 20).
        src={mediaThumbnailSrc(media)}
        alt={media.name}
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        loading="lazy"
        decoding="async"
      />
    );
  }

  if (media.type === 'youtube') {
    const videoId = parseYouTubeId(media.url);
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Play className={compact ? "w-4 h-4 text-zinc-400 dark:text-white" : "w-12 h-12 text-zinc-300 dark:text-zinc-600"} />
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
      <TypeIcon type={media.type} className={compact ? "w-4 h-4 text-zinc-400 dark:text-white" : "w-16 h-16 text-zinc-300 dark:text-zinc-600"} />
    </div>
  );
}
