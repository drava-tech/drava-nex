import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, FileWarningIcon, Loader2Icon } from "lucide-react"
import { useSearchParams } from "react-router"

/**
 * Document viewers are full pages at /display/<kind>?src=<url>, loaded into a
 * display's iframe. They fetch the file themselves (so the bucket's CORS policy
 * must allow this origin) and render it in the browser.
 */

/** Only our own relative paths or plain http(s) URLs — never javascript: etc. */
export function resolveSource(raw: string | null): string | null {
  if (!raw) return null
  if (raw.startsWith("/") && !raw.startsWith("//")) return new URL(raw, window.location.origin).toString()
  try {
    const url = new URL(raw)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch {
    return null
  }
}

export type DocState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T }

/** Fetches `?src=` once and parses it with `parse`. */
export function useDocument<T>(parse: (res: Response) => Promise<T>): DocState<T> & { src: string | null } {
  const [params] = useSearchParams()
  const src = resolveSource(params.get("src"))
  const [state, setState] = useState<DocState<T>>({ status: "loading" })
  const parseRef = useRef(parse)
  parseRef.current = parse

  useEffect(() => {
    if (!src) {
      setState({ status: "error", message: "No document to show." })
      return
    }
    const controller = new AbortController()
    setState({ status: "loading" })
    fetch(src, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`The file could not be loaded (${res.status}).`)
        return parseRef.current(res)
      })
      .then((data) => setState({ status: "ready", data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          message:
            err instanceof TypeError
              ? "The file could not be reached — check the storage CORS policy allows this site."
              : err instanceof Error
                ? err.message
                : "This document could not be shown.",
        })
      })
    return () => controller.abort()
  }, [src])

  return { ...state, src }
}

export function ViewerStatus({ state }: { state: { status: "loading" } | { status: "error"; message: string } }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0a] p-8 text-center text-zinc-400">
      {state.status === "loading" ? (
        <Loader2Icon className="size-8 animate-spin" aria-label="Loading" />
      ) : (
        <>
          <FileWarningIcon className="size-10" strokeWidth={1.25} />
          <p className="max-w-md text-lg" data-testid="viewer-error">
            {state.message}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Paging for unattended screens: one page or slide at a time, advancing on its
 * own every `?advance=` seconds (default 10, 0 = never) and wrapping around, so
 * a deck on a wall keeps moving without anyone touching it. On a touch screen a
 * tap on the left or right half steps manually, as do the arrow keys; either
 * restarts the countdown.
 */
export function usePager(count: number) {
  const [params] = useSearchParams()
  const advanceSec = Number(params.get("advance") ?? 10)
  const [index, setIndex] = useState(0)
  const [tick, setTick] = useState(0) // bumps to restart the countdown

  const go = useCallback(
    (delta: number) => {
      if (count <= 1) return
      setIndex((i) => (((i + delta) % count) + count) % count)
      setTick((t) => t + 1)
    },
    [count]
  )

  useEffect(() => {
    if (count <= 1 || !(advanceSec > 0)) return
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), advanceSec * 1000)
    return () => clearTimeout(id)
  }, [index, tick, count, advanceSec])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") go(1)
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go])

  return { index, count, go }
}

/** Invisible left/right tap zones plus a small "3 / 12" counter. */
export function PagerOverlay({ index, count, go }: { index: number; count: number; go: (d: number) => void }) {
  if (count <= 1) return null
  return (
    <>
      <button
        type="button"
        aria-label="Previous"
        onClick={() => go(-1)}
        className="group fixed inset-y-0 left-0 z-10 flex w-1/3 items-center justify-start pl-6 outline-none"
      >
        <ChevronLeftIcon className="size-10 text-white/0 transition group-hover:text-white/50" />
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={() => go(1)}
        className="group fixed inset-y-0 right-0 z-10 flex w-1/3 items-center justify-end pr-6 outline-none"
      >
        <ChevronRightIcon className="size-10 text-white/0 transition group-hover:text-white/50" />
      </button>
      <div
        className="fixed right-4 bottom-4 z-10 rounded-full bg-black/50 px-3 py-1 font-mono text-xs text-white/70 tabular-nums"
        data-testid="pager"
      >
        {index + 1} / {count}
      </div>
    </>
  )
}

/** Tracks the viewport size, debounced (re-rendering a page is not free). */
export function useViewportSize(delayMs = 200) {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(() => setSize({ w: window.innerWidth, h: window.innerHeight }), delayMs)
    }
    window.addEventListener("resize", onResize)
    return () => {
      clearTimeout(t)
      window.removeEventListener("resize", onResize)
    }
  }, [delayMs])
  return size
}
