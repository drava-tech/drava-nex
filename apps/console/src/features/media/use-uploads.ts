import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"

import { mediaKeys } from "./queries"
import { uploadFile, type UploadPhase } from "./upload"

export type UploadStatus = "queued" | UploadPhase | "done" | "error" | "cancelled"

export type UploadTask = {
  id: string
  file: File
  progress: number
  status: UploadStatus
  error?: string
}

/** Two at a time: parallel enough to hide latency, not so many that each crawls. */
const CONCURRENCY = 2

export function useUploads() {
  const qc = useQueryClient()
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const running = useRef(new Set<string>())

  const patch = useCallback((id: string, next: Partial<UploadTask>) => {
    setTasks((all) => all.map((t) => (t.id === id ? { ...t, ...next } : t)))
  }, [])

  const run = useCallback(
    async (task: UploadTask) => {
      const controller = new AbortController()
      controllers.current.set(task.id, controller)
      running.current.add(task.id)
      try {
        await uploadFile(task.file, {
          signal: controller.signal,
          onProgress: (progress, status) => patch(task.id, { progress, status }),
        })
        patch(task.id, { status: "done", progress: 1 })
        void qc.invalidateQueries({ queryKey: mediaKeys.all })
      } catch (err) {
        if (controller.signal.aborted) patch(task.id, { status: "cancelled" })
        else patch(task.id, { status: "error", error: err instanceof Error ? err.message : "Upload failed" })
      } finally {
        controllers.current.delete(task.id)
        running.current.delete(task.id)
        setTasks((all) => [...all]) // re-evaluate the queue
      }
    },
    [patch, qc]
  )

  // Start queued tasks whenever a slot is free.
  useEffect(() => {
    const free = CONCURRENCY - running.current.size
    if (free <= 0) return
    tasks
      .filter((t) => t.status === "queued" && !running.current.has(t.id))
      .slice(0, free)
      .forEach((t) => {
        running.current.add(t.id)
        void run(t)
      })
  }, [tasks, run])

  // Abandoning the page abandons the uploads (the reaper cleans up storage).
  useEffect(() => {
    const map = controllers.current
    return () => map.forEach((c) => c.abort())
  }, [])

  const add = useCallback((files: File[]) => {
    setTasks((all) => [
      ...all,
      ...files.map((file) => ({ id: crypto.randomUUID(), file, progress: 0, status: "queued" as const })),
    ])
  }, [])

  const cancel = useCallback((id: string) => {
    const controller = controllers.current.get(id)
    if (controller) controller.abort()
    else setTasks((all) => all.map((t) => (t.id === id && t.status === "queued" ? { ...t, status: "cancelled" } : t)))
  }, [])

  const clearFinished = useCallback(() => {
    setTasks((all) => all.filter((t) => !["done", "error", "cancelled"].includes(t.status)))
  }, [])

  const busy = tasks.some((t) => !["done", "error", "cancelled"].includes(t.status))

  return { tasks, add, cancel, clearFinished, busy }
}
