"use client";

import { useState, useTransition } from "react";
import {
  ImagePlus,
  Film,
  FileText,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { Button } from "@platform/ui";
import type { UpdateProductInput, ProductMediaPurpose } from "@platform/types";
import type { ProductDetail } from "@platform/db";
import { MediaPicker, type MediaPickerItem } from "@/components/media-picker";
import { updateProductAction, addMediaAction, removeMediaAction } from "@/actions/product-actions";

type ProductMediaRow = ProductDetail["media"][number];

interface DirectSlot {
  field: "thumbnailMediaId" | "heroMediaId" | "demoVideoMediaId";
  id: string | null;
  url: string | null;
}

export function ProductMediaEditor({ product }: { product: ProductDetail }) {
  const productId = product.id;
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Direct single-slot refs (stored as columns on the product row).
  const [slots, setSlots] = useState<Record<DirectSlot["field"], { id: string | null; url: string | null }>>({
    thumbnailMediaId: { id: product.thumbnailMediaId, url: product.thumbnailUrl },
    heroMediaId: { id: product.heroMediaId, url: product.heroUrl },
    demoVideoMediaId: { id: product.demoVideoMediaId, url: product.demoVideoUrl },
  });

  const [gallery, setGallery] = useState<ProductMediaRow[]>(
    product.media.filter((m) => m.purpose === "GALLERY").sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [docs, setDocs] = useState<ProductMediaRow[]>(
    product.media
      .filter((m) => m.purpose === "BROCHURE" || m.purpose === "DOCUMENT")
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );

  // Which picker is open.
  const [picker, setPicker] = useState<
    | { kind: "slot"; field: DirectSlot["field"]; accept: "image" | "video" }
    | { kind: "gallery" }
    | { kind: "doc" }
    | null
  >(null);

  const setSlot = (field: DirectSlot["field"], value: { id: string | null; url: string | null }) => {
    startTransition(async () => {
      const patch = { [field]: value.id } as UpdateProductInput;
      const res = await updateProductAction(productId, patch);
      if (res.success) setSlots((s) => ({ ...s, [field]: value }));
      else setError(res.error ?? "Failed to update media.");
    });
  };

  const addLink = (purpose: ProductMediaPurpose, item: MediaPickerItem, list: ProductMediaRow[]) => {
    startTransition(async () => {
      const res = await addMediaAction(productId, {
        mediaId: item.id,
        purpose,
        sortOrder: list.length,
      });
      if (res.success && res.data) {
        const row = res.data as ProductMediaRow;
        const enriched = { ...row, url: item.url, name: item.name };
        if (purpose === "GALLERY") setGallery((g) => [...g, enriched]);
        else setDocs((d) => [...d, enriched]);
      } else {
        setError(res.error ?? "Failed to add media.");
      }
    });
  };

  const removeLink = (row: ProductMediaRow, purpose: "GALLERY" | "DOC") => {
    startTransition(async () => {
      const res = await removeMediaAction(productId, row.id);
      if (res.success) {
        if (purpose === "GALLERY") setGallery((g) => g.filter((x) => x.id !== row.id));
        else setDocs((d) => d.filter((x) => x.id !== row.id));
      } else {
        setError(res.error ?? "Failed to remove media.");
      }
    });
  };

  const moveGallery = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= gallery.length) return;
    const reordered = [...gallery];
    const a = reordered[index]!;
    const b = reordered[target]!;
    reordered[index] = b;
    reordered[target] = a;
    setGallery(reordered);
    startTransition(async () => {
      await Promise.all([
        addMediaAction(productId, { mediaId: a.mediaId, purpose: "GALLERY", sortOrder: target }),
        addMediaAction(productId, { mediaId: b.mediaId, purpose: "GALLERY", sortOrder: index }),
      ]);
    });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Direct slots */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SlotCard
          label="Thumbnail"
          icon={<ImagePlus className="h-5 w-5" />}
          url={slots.thumbnailMediaId.url}
          isVideo={false}
          onPick={() => setPicker({ kind: "slot", field: "thumbnailMediaId", accept: "image" })}
          onClear={() => setSlot("thumbnailMediaId", { id: null, url: null })}
          disabled={isPending}
        />
        <SlotCard
          label="Hero image"
          icon={<ImagePlus className="h-5 w-5" />}
          url={slots.heroMediaId.url}
          isVideo={false}
          onPick={() => setPicker({ kind: "slot", field: "heroMediaId", accept: "image" })}
          onClear={() => setSlot("heroMediaId", { id: null, url: null })}
          disabled={isPending}
        />
        <SlotCard
          label="Demo video"
          icon={<Film className="h-5 w-5" />}
          url={slots.demoVideoMediaId.url}
          isVideo
          onPick={() => setPicker({ kind: "slot", field: "demoVideoMediaId", accept: "video" })}
          onClear={() => setSlot("demoVideoMediaId", { id: null, url: null })}
          disabled={isPending}
        />
      </section>

      {/* Gallery */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Gallery</h2>
          <Button type="button" size="sm" variant="outline" onClick={() => setPicker({ kind: "gallery" })}>
            <Plus className="h-4 w-4" /> Add image
          </Button>
        </div>
        {gallery.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No gallery images yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {gallery.map((g, i) => (
              <div key={g.id} className="group relative h-28 w-40 overflow-hidden rounded-lg border bg-muted">
                {g.mediaType === "video" ? (
                  <video src={g.url ?? undefined} muted playsInline className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.url ?? undefined} alt={g.name ?? ""} className="h-full w-full object-cover" />
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => moveGallery(i, -1)}
                      disabled={i === 0 || isPending}
                      className="p-1 text-white/80 hover:text-white disabled:opacity-30"
                      title="Move left"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveGallery(i, 1)}
                      disabled={i === gallery.length - 1 || isPending}
                      className="p-1 text-white/80 hover:text-white disabled:opacity-30"
                      title="Move right"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLink(g, "GALLERY")}
                    className="p-1 text-red-300 hover:text-red-200"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Documents / brochures */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Brochures &amp; documents</h2>
          <Button type="button" size="sm" variant="outline" onClick={() => setPicker({ kind: "doc" })}>
            <Plus className="h-4 w-4" /> Add file
          </Button>
        </div>
        {docs.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No documents attached.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <a href={d.url ?? "#"} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
                  {d.name ?? d.url}
                </a>
                <button
                  type="button"
                  onClick={() => removeLink(d, "DOC")}
                  className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <MediaPicker
        open={picker !== null}
        accept={picker?.kind === "slot" ? picker.accept : picker?.kind === "doc" ? "all" : "image"}
        onClose={() => setPicker(null)}
        onSelectItem={(item) => {
          if (!picker) return;
          if (picker.kind === "slot") setSlot(picker.field, { id: item.id, url: item.url });
          else if (picker.kind === "gallery") addLink("GALLERY", item, gallery);
          else addLink("BROCHURE", item, docs);
        }}
      />
    </div>
  );
}

function SlotCard({
  label,
  icon,
  url,
  isVideo,
  onPick,
  onClear,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  url: string | null;
  isVideo: boolean;
  onPick: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-muted">
        {url ? (
          isVideo ? (
            <video src={url} muted playsInline className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={label} className="h-full w-full object-cover" />
          )
        ) : (
          <span className="text-muted-foreground">{icon}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onPick} disabled={disabled}>
          {url ? "Replace" : "Select"}
        </Button>
        {url && (
          <Button type="button" size="sm" variant="ghost" onClick={onClear} disabled={disabled}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
