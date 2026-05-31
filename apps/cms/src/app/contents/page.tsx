import React from "react";
import Link from "next/link";
import { readContentsJson } from "../../lib/config-writer";
import { addContent, removeContent } from "../../actions/content-actions";

export default async function ContentsPage() {
  const contentsData = await readContentsJson();
  const contents = contentsData.contents || [];

  async function handleAdd(formData: FormData) {
    "use server";
    const id = formData.get("id") as string;
    const source = formData.get("source") as string;
    const loop = formData.get("loop") === "on";
    const muted = formData.get("muted") === "on";

    if (id && source) {
      try {
        await addContent(id, source, loop, muted);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function handleDelete(formData: FormData) {
    "use server";
    const id = formData.get("id") as string;
    if (id) {
      await removeContent(id);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#09090b",
        color: "#fafafa",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "3rem 2rem",
      }}
    >
      {/* Pure CSS Hover Styles for Server Components */}
      <style dangerouslySetInnerHTML={{ __html: `
        .btn-delete {
          background-color: transparent;
          color: #ef4444;
          transition: background-color 0.2s;
        }
        .btn-delete:hover {
          background-color: rgba(239, 68, 68, 0.1);
        }
        .btn-add {
          background-color: #10b981;
          color: #ffffff;
          transition: background-color 0.2s;
        }
        .btn-add:hover {
          background-color: #059669;
        }
      `}} />

      {/* Navigation Header */}
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto 3rem auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #27272a",
          paddingBottom: "1.5rem",
        }}
      >
        <div>
          <span style={{ fontSize: "0.875rem", color: "#3b82f6", fontWeight: 600 }}>CMS CONTROL CENTER</span>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, margin: "0.25rem 0 0 0", color: "#ffffff" }}>
            Content Library
          </h1>
        </div>
        <nav style={{ display: "flex", gap: "1rem" }}>
          <Link
            href="/"
            style={{
              color: "#a1a1aa",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              transition: "all 0.2s",
            }}
          >
            Dashboard
          </Link>
          <Link
            href="/screens"
            style={{
              color: "#a1a1aa",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              transition: "all 0.2s",
            }}
          >
            Screens
          </Link>
          <Link
            href="/contents"
            style={{
              color: "#ffffff",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: 600,
              padding: "0.5rem 1rem",
              backgroundColor: "#27272a",
              borderRadius: "6px",
            }}
          >
            Content Library
          </Link>
        </nav>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 340px", gap: "2.5rem" }}>
        
        {/* Main Section: Content Lists */}
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#e4e4e7", marginBottom: "1.5rem" }}>
            Available Assets ({contents.length})
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
            {contents.map((content: any) => (
              <div
                key={content.id}
                style={{
                  backgroundColor: "#18181b",
                  borderRadius: "12px",
                  border: "1px solid #27272a",
                  padding: "1.5rem",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "1.5rem",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0, color: "#ffffff" }}>
                        {content.id}
                      </h3>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          backgroundColor: "#3b82f6",
                          color: "#ffffff",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "4px",
                          textTransform: "uppercase",
                          fontWeight: 700,
                        }}
                      >
                        {content.type}
                      </span>
                    </div>

                    <form action={handleDelete}>
                      <input type="hidden" name="id" value={content.id} />
                      <button
                        type="submit"
                        className="btn-delete"
                        style={{
                          border: "none",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                          cursor: "pointer",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "4px",
                        }}
                      >
                        Delete
                      </button>
                    </form>
                  </div>

                  <div style={{ fontSize: "0.875rem", color: "#a1a1aa", marginBottom: "1rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ color: "#71717a", fontWeight: 600 }}>SOURCE:</span> {content.source}
                  </div>

                  <div style={{ display: "flex", gap: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: "6px",
                          height: "6px",
                          backgroundColor: content.loop ? "#10b981" : "#71717a",
                          borderRadius: "50%",
                        }}
                      />
                      <span style={{ fontSize: "0.75rem", color: "#71717a" }}>Looping: {content.loop ? "ON" : "OFF"}</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: "6px",
                          height: "6px",
                          backgroundColor: content.muted ? "#10b981" : "#71717a",
                          borderRadius: "50%",
                        }}
                      />
                      <span style={{ fontSize: "0.75rem", color: "#71717a" }}>Muted: {content.muted ? "ON" : "OFF"}</span>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#09090b",
                    padding: "0.6rem 0.75rem",
                    borderRadius: "6px",
                    fontSize: "0.75rem",
                    fontFamily: "monospace",
                    color: "#71717a",
                  }}
                >
                  Type: Video • Extensible
                </div>
              </div>
            ))}

            {contents.length === 0 && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: "3rem",
                  textAlign: "center",
                  backgroundColor: "#18181b",
                  borderRadius: "12px",
                  border: "1px solid #27272a",
                  color: "#71717a",
                }}
              >
                No content assets registered. Use the configuration panel to define your first video!
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Panel: Add content */}
        <div>
          <div
            style={{
              backgroundColor: "#18181b",
              borderRadius: "12px",
              border: "1px solid #27272a",
              padding: "1.5rem",
              position: "sticky",
              top: "2rem",
            }}
          >
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 1.25rem 0", color: "#ffffff" }}>
              Add Video Asset
            </h2>

            <form action={handleAdd} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#a1a1aa" }}>CONTENT ID</label>
                <input
                  type="text"
                  name="id"
                  placeholder="e.g. promo-video-lobby"
                  required
                  style={{
                    backgroundColor: "#09090b",
                    border: "1px solid #27272a",
                    color: "#ffffff",
                    borderRadius: "6px",
                    padding: "0.6rem 0.75rem",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#a1a1aa" }}>VIDEO SOURCE URL</label>
                <input
                  type="text"
                  name="source"
                  placeholder="e.g. /media/promo.mp4"
                  required
                  style={{
                    backgroundColor: "#09090b",
                    border: "1px solid #27272a",
                    color: "#ffffff",
                    borderRadius: "6px",
                    padding: "0.6rem 0.75rem",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.25rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
                  <input type="checkbox" name="loop" defaultChecked style={{ width: "1rem", height: "1rem" }} />
                  <span>Loop video continuously</span>
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
                  <input type="checkbox" name="muted" defaultChecked style={{ width: "1rem", height: "1rem" }} />
                  <span>Mute audio (required for autoplay)</span>
                </label>
              </div>

              <button
                type="submit"
                className="btn-add"
                style={{
                  border: "none",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  marginTop: "0.5rem",
                }}
              >
                Add to Library
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
