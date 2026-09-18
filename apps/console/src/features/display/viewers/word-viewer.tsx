import "./word-viewer.css"

import { useDocument, ViewerStatus } from "./shared"

/**
 * mammoth converts .docx to semantic HTML (it drops layout on purpose), which
 * reads well on a screen. Its output is still sanitised: a document is
 * uploaded content, and a hyperlink inside it may carry a javascript: URL.
 */
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")
  doc.querySelectorAll("script, iframe, object, embed, style, link, meta").forEach((el) => el.remove())
  for (const el of doc.body.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const value = attr.value.trim().toLowerCase()
      if (attr.name.startsWith("on") || ((attr.name === "href" || attr.name === "src") && value.startsWith("javascript:"))) {
        el.removeAttribute(attr.name)
      }
    }
  }
  return doc.body.innerHTML
}

async function convert(res: Response): Promise<string> {
  // The browser build avoids mammoth's Node-only code paths.
  const { default: mammoth } = await import("mammoth/mammoth.browser")
  const result = await mammoth.convertToHtml({ arrayBuffer: await res.arrayBuffer() })
  return sanitize(result.value)
}

export function WordViewer() {
  const doc = useDocument(convert)
  if (doc.status !== "ready") return <ViewerStatus state={doc} />
  return (
    <div className="fixed inset-0 overflow-auto bg-[#0a0a0a]" data-testid="word-viewer">
      <article className="word-doc mx-auto max-w-4xl px-10 py-16" dangerouslySetInnerHTML={{ __html: doc.data }} />
    </div>
  )
}
