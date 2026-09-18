import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CreateScreenRequest, PairingCodeResponse, Screen, ScreenDetail } from "@workspace/types"

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

export function useScreen(id: string | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: screenKeys.detail(id ?? ""),
    queryFn: () => api<Screen>(`/api/screens/${id}`),
    enabled: Boolean(id),
    refetchInterval: opts.refetchInterval ?? false,
  })
}

export function useIssuePairingCode() {
  return useMutation({
    mutationFn: (id: string) =>
      api<PairingCodeResponse>(`/api/screens/${id}/pairing-code`, { method: "POST" }),
  })
}

export function useUnpairScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ unpaired: true }>(`/api/screens/${id}/pairing`, { method: "DELETE" }),
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

// ─── Screen control page ───────────────────────────────────────────────────

export function useScreenDetail(id: string) {
  return useQuery({
    queryKey: screenKeys.detail(id),
    queryFn: () => api<ScreenDetail>(`/api/screens/${id}`),
  })
}

type PushOutcome = { screenId: string; players: number; queueIndex?: number; queueLength?: number }

/** All push controls share one mutation shape: POST, then refresh the screen. */
function useScreenAction<V>(path: (vars: V) => string, body: (vars: V) => unknown) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: V) => api<PushOutcome>(path(vars), { method: "POST", json: body(vars) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: screenKeys.all }),
  })
}

export const usePushMedia = (id: string) =>
  useScreenAction<string | null>(() => `/api/screens/${id}/media`, (mediaId) => ({ mediaId }))

export const usePushQueue = (id: string) =>
  useScreenAction<string[]>(() => `/api/screens/${id}/media-queue`, (mediaIds) => ({ mediaIds, startIndex: 0 }))

export const useNavigateQueue = (id: string) =>
  useScreenAction<"next" | "prev">(() => `/api/screens/${id}/queue/navigate`, (direction) => ({ direction }))

export const useSetDefaultMedia = (id: string) =>
  useScreenAction<string | null>(() => `/api/screens/${id}/default-media`, (mediaId) => ({ mediaId }))

export const useSetBlanked = (id: string) =>
  useScreenAction<boolean>(() => `/api/screens/${id}/blank`, (blanked) => ({ blanked }))

export const useScreenCommand = (id: string) =>
  useScreenAction<"RELOAD" | "MUTE" | "UNMUTE">(() => `/api/screens/${id}/command`, (command) => ({ command }))
