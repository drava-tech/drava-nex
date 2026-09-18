import { useDocument, ViewerStatus } from "./shared"

type Cell = string | number | boolean | Date | null
type Sheet = { name: string; rows: Cell[][] }

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF. */
function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += ch
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}

async function load(res: Response): Promise<Sheet> {
  const isCsv =
    res.headers.get("content-type")?.includes("csv") || new URL(res.url).pathname.toLowerCase().endsWith(".csv")
  if (isCsv) return { name: "", rows: parseCsv(await res.text()) }
  const { default: readXlsxFile } = await import("read-excel-file/browser")
  const sheets = (await readXlsxFile(await res.blob())) as unknown as { sheet: string; data: Cell[][] }[] | Cell[][]
  // v9 returns every sheet; older versions return the first sheet's rows.
  if (Array.isArray(sheets) && sheets.length && !Array.isArray(sheets[0])) {
    const first = (sheets as { sheet: string; data: Cell[][] }[])[0]!
    return { name: first.sheet, rows: first.data }
  }
  return { name: "", rows: sheets as Cell[][] }
}

function show(cell: Cell): string {
  if (cell == null) return ""
  if (cell instanceof Date) return cell.toLocaleDateString()
  if (typeof cell === "number") return cell.toLocaleString()
  return String(cell)
}

/** The first sheet as a table, the first row as a sticky header. */
export function SheetViewer() {
  const doc = useDocument(load)
  if (doc.status !== "ready") return <ViewerStatus state={doc} />
  const [header = [], ...body] = doc.data.rows
  const width = Math.max(header.length, ...body.map((r) => r.length))

  return (
    <div className="fixed inset-0 overflow-auto bg-[#0a0a0a] p-8 text-zinc-200" data-testid="sheet-viewer">
      {doc.data.name && <h1 className="mb-4 text-2xl font-semibold text-white">{doc.data.name}</h1>}
      <table className="w-full border-collapse text-lg">
        <thead className="sticky top-0 bg-zinc-800 text-left text-white">
          <tr>
            {Array.from({ length: width }, (_, i) => (
              <th key={i} className="border border-zinc-700 px-3 py-2 font-semibold">
                {show(header[i] ?? null)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="odd:bg-white/[0.03]">
              {Array.from({ length: width }, (_, c) => (
                <td key={c} className={`border border-zinc-800 px-3 py-2 ${typeof row[c] === "number" ? "text-right tabular-nums" : ""}`}>
                  {show(row[c] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
