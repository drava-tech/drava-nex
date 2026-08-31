"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/** Only same-origin/relative sources are loadable — anything else fails CORS anyway. */
function resolveSource(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function WordViewer() {
  const params = useSearchParams();
  const src = params.get("src");

  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (source: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status})`);

      // Imported lazily so mammoth (and its dependencies) never land in the
      // shared bundle — this route is the only thing that needs it. The
      // browser-specific entry point avoids mammoth's Node/fs-dependent code.
      const mammoth = await import("mammoth/mammoth.browser");
      const arrayBuffer = await res.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      setHtml(result.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this document");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const source = resolveSource(src);
    if (!source) {
      setError("No document specified");
      setLoading(false);
      return;
    }
    void load(source);
  }, [src, load]);

  if (loading) {
    return <Centered>Loading document…</Centered>;
  }

  if (error) {
    return <Centered tone="error">{error}</Centered>;
  }

  if (!html) {
    return <Centered>This document is empty</Centered>;
  }

  return (
    <div className="fixed inset-0 overflow-auto bg-[#0a0a0a]">
      <div
        className="word-doc mx-auto max-w-3xl px-8 py-12 text-zinc-200"
        // mammoth's output is semantic HTML converted from a document the
        // admin uploaded or emailed themselves — same trust level as the PDF/
        // pptx content this same route family already renders unsanitized.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style jsx global>{`
        .word-doc {
          font-size: 16px;
          line-height: 1.7;
        }
        .word-doc h1, .word-doc h2, .word-doc h3, .word-doc h4 {
          font-weight: 600;
          color: #fafafa;
          margin: 1.5em 0 0.5em;
        }
        .word-doc h1 { font-size: 2em; }
        .word-doc h2 { font-size: 1.5em; }
        .word-doc h3 { font-size: 1.25em; }
        .word-doc p { margin: 0.75em 0; }
        .word-doc a { color: #60a5fa; text-decoration: underline; }
        .word-doc strong { font-weight: 700; color: #fafafa; }
        .word-doc ul, .word-doc ol { margin: 0.75em 0; padding-left: 1.5em; }
        .word-doc li { margin: 0.25em 0; }
        .word-doc img { max-width: 100%; height: auto; margin: 1em 0; }
        .word-doc table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        .word-doc td, .word-doc th {
          border: 1px solid rgba(255, 255, 255, 0.15);
          padding: 0.5em 0.75em;
        }
        .word-doc th { font-weight: 600; background: rgba(255, 255, 255, 0.05); }
      `}</style>
    </div>
  );
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a] p-8 text-center">
      <p className={`text-lg ${tone === "error" ? "text-red-400" : "text-zinc-400"}`}>{children}</p>
    </div>
  );
}
