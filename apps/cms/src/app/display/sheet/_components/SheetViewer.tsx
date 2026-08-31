"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Centered, resolveSource } from "../../_components/viewer-common";

// Cells are rendered as text whatever they hold, so the parser's own union
// (which varies by version) isn't worth mirroring here.
type Cell = unknown;
type Row = Cell[];

interface SheetTab {
  name: string;
  rows: Row[];
}

/**
 * Parse CSV text: handles quoted fields, escaped quotes ("") and newlines
 * inside quotes. Small enough not to justify a dependency on top of the xlsx
 * reader, which doesn't handle CSV anyway.
 */
function parseCsv(text: string): Row[] {
  const rows: Row[] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;

  // Normalise line endings so CRLF files don't leave \r on every last field.
  const src = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }

  // Trailing field/row (files without a final newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function formatCell(value: Cell): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** A row is padded out to the widest row in the sheet, so ragged data lines up. */
function cellAt(row: Row | undefined, index: number): Cell {
  return row?.[index] ?? null;
}

export function SheetViewer() {
  const params = useSearchParams();
  const src = params.get("src");

  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (source: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status})`);

      const isCsv = new URL(source).pathname.toLowerCase().endsWith(".csv");

      if (isCsv) {
        setTabs([{ name: "Sheet 1", rows: parseCsv(await res.text()) }]);
      } else {
        // Imported lazily so the xlsx parser never lands in the shared bundle —
        // this route is the only thing that needs it.
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        const sheets = await readXlsxFile(await res.blob());
        setTabs(sheets.map((s, i) => ({ name: s.sheet || `Sheet ${i + 1}`, rows: s.data as Row[] })));
      }
      setActiveTab(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this spreadsheet");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const source = resolveSource(src);
    if (!source) {
      setError("No spreadsheet specified");
      setLoading(false);
      return;
    }
    void load(source);
  }, [src, load]);

  const sheet = tabs[activeTab];
  const [headerRow, ...bodyRows] = useMemo(() => sheet?.rows ?? [], [sheet]);

  // Ragged sheets are normal — size every row to the widest one.
  const columnCount = useMemo(
    () => (sheet?.rows ?? []).reduce((max, r) => Math.max(max, r.length), 0),
    [sheet]
  );

  if (loading) {
    return <Centered>Loading spreadsheet…</Centered>;
  }

  if (error) {
    return <Centered tone="error">{error}</Centered>;
  }

  if (!sheet || sheet.rows.length === 0) {
    return <Centered>This spreadsheet is empty</Centered>;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0a0a0a] text-zinc-100">
      {tabs.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-4 py-2">
          {tabs.map((tab, i) => (
            <button
              key={tab.name}
              onClick={() => setActiveTab(i)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                i === activeTab
                  ? "bg-blue-600 text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-sm tabular-nums">
          {headerRow && (
            <thead className="sticky top-0 z-10 bg-[#141414]">
              <tr>
                {Array.from({ length: columnCount }, (_, i) => (
                  <th
                    key={i}
                    className="whitespace-nowrap border-b border-white/15 px-4 py-3 font-semibold text-zinc-200"
                  >
                    {formatCell(cellAt(headerRow, i))}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {bodyRows.map((row, r) => (
              <tr key={r} className={r % 2 === 1 ? "bg-white/[0.03]" : undefined}>
                {Array.from({ length: columnCount }, (_, c) => (
                  <td key={c} className="border-b border-white/5 px-4 py-2.5 text-zinc-300">
                    {formatCell(cellAt(row, c))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
