import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CreateScreenRequest, Screen } from "@workspace/types"

import { api } from "@/lib/api"

export const screenKeys = {
  all: ["screens"] as const,
  detail: (id: string) => ["screens", id] as const,
}

export function useScreens() {
  return useQuery({
    queryKey: screenKeys.all,
    queryFn: () => api<Screen[]>("/api/screens"),
  })
}

export function useCreateScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateScreenRequest) =>
      api<Screen>("/api/screens", { method: "POST", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: screenKeys.all }),
  })
}

export function useRenameScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<Screen>(`/api/screens/${id}`, { method: "PATCH", json: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: screenKeys.all }),
  })
}

export function useDeleteScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ deleted: true }>(`/api/screens/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: screenKeys.all }),
  })
}
