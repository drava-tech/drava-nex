"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface WhiteboardEditorContextValue {
  /** Set by openWhiteboardDocument, consumed (and cleared) by the global WhiteboardOverlay. */
  requestedDocumentId: string | null;
  openWhiteboardDocument: (id: string) => void;
  clearRequestedDocument: () => void;
}

const WhiteboardEditorContext = createContext<WhiteboardEditorContextValue | null>(null);

/**
 * Bridges the /whiteboards list page (a normal route, inside `children`) and
 * the globally-mounted `<WhiteboardOverlay />` (a sibling of `children` in the
 * dashboard layout) — "Open" on a saved whiteboard sets a request here, the
 * overlay watches it, loads the document, and clears it back to null.
 */
export function WhiteboardEditorProvider({ children }: { children: ReactNode }) {
  const [requestedDocumentId, setRequestedDocumentId] = useState<string | null>(null);
  const openWhiteboardDocument = useCallback((id: string) => setRequestedDocumentId(id), []);
  const clearRequestedDocument = useCallback(() => setRequestedDocumentId(null), []);

  return (
    <WhiteboardEditorContext.Provider
      value={{ requestedDocumentId, openWhiteboardDocument, clearRequestedDocument }}
    >
      {children}
    </WhiteboardEditorContext.Provider>
  );
}

export function useWhiteboardEditor(): WhiteboardEditorContextValue {
  const ctx = useContext(WhiteboardEditorContext);
  if (!ctx) throw new Error("useWhiteboardEditor must be used within WhiteboardEditorProvider");
  return ctx;
}
