import React from "react";
import Link from "next/link";
import { readScreensJson, readContentsJson } from "../../lib/config-writer";
import { assignContent, addScreen, removeScreen } from "../../actions/screen-actions";

export default async function ScreensPage() {
  const [screensData, contentsData] = await Promise.all([
    readScreensJson(),
    readContentsJson(),
  ]);

  const screens = screensData.screens || [];
  const contents = contentsData.contents || [];

  // Form submit handlers (Server Actions in Forms)
  async function handleAssign(formData: FormData) {
    "use server";
    const screenId = formData.get("screenId") as string;
    const contentId = formData.get("contentId") as string;
    if (screenId && contentId) {
      await assignContent(screenId, contentId);
    }
  }

  async function handleAdd(formData: FormData) {
    "use server";
    const screenId = formData.get("screenId") as string;
    const screenName = formData.get("screenName") as string;
    const contentId = formData.get("contentId") as string;
    if (screenId && screenName && contentId) {
      try {
        await addScreen(screenId, screenName, contentId);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function handleDelete(formData: FormData) {
    "use server";
    const screenId = formData.get("screenId") as string;
    if (screenId) {
      await removeScreen(screenId);
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
        .btn-remove {
          background-color: transparent;
          color: #ef4444;
          transition: background-color 0.2s;
        }
        .btn-remove:hover {
          background-color: rgba(239, 68, 68, 0.1);
        }
        .btn-update {
          background-color: #3b82f6;
          color: #ffffff;
          transition: background-color 0.2s;
        }
        .btn-update:hover {
          background-color: #2563eb;
        }
        .btn-register {
          background-color: #10b981;
          color: #ffffff;
          transition: background-color 0.2s;
        }
        .btn-register:hover {
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
            Screen Management
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
              border: "1px solid transparent",
              transition: "all 0.2s",
            }}
          >
            Dashboard
          </Link>
          <Link
            href="/screens"
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
            Screens
          </Link>
          <Link
            href="/contents"
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
            Content Library
          </Link>
        </nav>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 340px", gap: "2.5rem" }}>
        
        {/* Main Grid: Screen list */}
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#e4e4e7", marginBottom: "1.5rem" }}>
            Active Screens ({screens.length})
          </h2>

          <div style={{ display: "grid", gap: "1.5rem" }}>
            {screens.map((screen: any) => {
              const currentContent = contents.find((c: any) => c.id === screen.contentId);
              return (
                <div
                  key={screen.screenId}
                  style={{
                    backgroundColor: "#18181b",
                    borderRadius: "12px",
                    border: "1px solid #27272a",
                    padding: "1.5rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "1.25rem",
                    transition: "border-color 0.2s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <h3 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, color: "#ffffff" }}>
                          {screen.screenName}
                        </h3>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            backgroundColor: "#27272a",
                            color: "#a1a1aa",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "4px",
                            fontFamily: "monospace",
                          }}
                        >
                          {screen.screenId}
                        </span>
                      </div>
                      <p style={{ color: "#71717a", fontSize: "0.875rem", margin: "0.25rem 0 0 0" }}>
                        Assigned Content: <strong style={{ color: "#3b82f6" }}>{screen.contentId}</strong>
                        {currentContent && ` (${currentContent.type} · ${currentContent.source})`}
                      </p>
                    </div>

                    <form action={handleDelete}>
                      <input type="hidden" name="screenId" value={screen.screenId} />
                      <button
                        type="submit"
                        className="btn-remove"
                        style={{
                          border: "none",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                          cursor: "pointer",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                        }}
                      >
                        Remove
                      </button>
                    </form>
                  </div>

                  {/* Assign Content Mini Form */}
                  <form
                    action={handleAssign}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      backgroundColor: "#09090b",
                      padding: "0.75rem 1rem",
                      borderRadius: "8px",
                      border: "1px solid #27272a",
                    }}
                  >
                    <input type="hidden" name="screenId" value={screen.screenId} />
                    <span style={{ fontSize: "0.875rem", color: "#a1a1aa", whiteSpace: "nowrap" }}>Change content to:</span>
                    <select
                      name="contentId"
                      defaultValue={screen.contentId}
                      style={{
                        flex: 1,
                        backgroundColor: "#18181b",
                        border: "1px solid #27272a",
                        color: "#ffffff",
                        borderRadius: "6px",
                        padding: "0.4rem 0.75rem",
                        fontSize: "0.875rem",
                        outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      {contents.map((content: any) => (
                        <option key={content.id} value={content.id}>
                          {content.id} ({content.type})
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="btn-update"
                      style={{
                        border: "none",
                        borderRadius: "6px",
                        padding: "0.4rem 1rem",
                        fontSize: "0.875rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Update
                    </button>
                  </form>
                </div>
              );
            })}

            {screens.length === 0 && (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  backgroundColor: "#18181b",
                  borderRadius: "12px",
                  border: "1px solid #27272a",
                  color: "#71717a",
                }}
              >
                No screens configured. Use the form to configure your first signage display!
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: Add screen form */}
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
              Add New Screen
            </h2>

            <form action={handleAdd} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#a1a1aa" }}>SCREEN ID</label>
                <input
                  type="text"
                  name="screenId"
                  placeholder="e.g. tv-03"
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
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#a1a1aa" }}>SCREEN NAME</label>
                <input
                  type="text"
                  name="screenName"
                  placeholder="e.g. Lounge Wall TV"
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
                <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#a1a1aa" }}>DEFAULT CONTENT</label>
                <select
                  name="contentId"
                  required
                  style={{
                    backgroundColor: "#09090b",
                    border: "1px solid #27272a",
                    color: "#ffffff",
                    borderRadius: "6px",
                    padding: "0.6rem 0.75rem",
                    fontSize: "0.875rem",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {contents.map((content: any) => (
                    <option key={content.id} value={content.id}>
                      {content.id}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="btn-register"
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
                Register Screen
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
