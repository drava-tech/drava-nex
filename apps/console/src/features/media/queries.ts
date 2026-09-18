import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { CreateLinkRequest, MediaItem, MediaType, Page } from "@workspace/types"

import { api } from "@/lib/api"

export type MediaFilter = { type?: MediaType | undefined; search?: string | undefined }

export const mediaKeys = {
  all: ["media"] as const,
  list: (f: MediaFilter) => ["media", "list", f.type ?? "all", f.search ?? ""] as const,
}

export function useMediaList(filter: MediaFilter) {
  return useInfiniteQuery({
    queryKey: mediaKeys.list(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "40" })
      if (pageParam) qs.set("cursor", pageParam)
      if (filter.type) qs.set("type", filter.type)
      if (filter.search) qs.set("search", filter.search)
      return api<Page<MediaItem>>(`/api/media?${qs}`)
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Keep showing the current results while a new filter or search loads,
    // instead of flashing skeletons on every keystroke.
    placeholderData: keepPreviousData,
  })
}

export function useDeleteMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ deleted: true; affectedScreens: number }>(`/api/media/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mediaKeys.all })
      void qc.invalidateQueries({ queryKey: ["screens"] })
    },
  })
}

export function useCreateLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateLinkRequest) =>
      api<MediaItem>("/api/media/link", { method: "POST", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}
