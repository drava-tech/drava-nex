import React from "react";
import Link from "next/link";
import { readScreensJson, readContentsJson } from "../lib/config-writer";

export default async function DashboardPage() {
  const [screensData, contentsData] = await Promise.all([
    readScreensJson(),
    readContentsJson(),
  ]);

  const screens = screensData.screens || [];
  const contents = contentsData.contents || [];

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
      {/* Upper Brand / Stats Header */}
      <div style={{ maxWidth: "1100px", margin: "0 auto 3rem auto" }}>
        <span style={{ fontSize: "0.875rem", color: "#3b82f6", fontWeight: 700, letterSpacing: "0.1em" }}>
          CMS PLATFORM DASHBOARD
        </span>
        <h1 style={{ fontSize: "2.5rem", fontWeight: 850, margin: "0.25rem 0 0.5rem 0", color: "#ffffff" }}>
          Control Center
        </h1>
        <p style={{ color: "#71717a", fontSize: "1.05rem", margin: 0 }}>
          Real-time dynamic configuration for digital signage displays. Raw JSON synchronization powered.
        </p>
      </div>

      {/* Grid: Stat widgets */}
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto 2.5rem auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {/* Stat 1: Screens */}
        <Link
          href="/screens"
          style={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "12px",
            padding: "1.5rem",
            textDecoration: "none",
            color: "inherit",
            transition: "border-color 0.2s, transform 0.2s",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: "0.875rem", color: "#71717a", fontWeight: 600 }}>MONITORED SCREENS</div>
          <div style={{ fontSize: "2.5rem", fontWeight: 800, color: "#ffffff", margin: "0.5rem 0" }}>
            {screens.length}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#3b82f6", fontWeight: 500 }}>
            Configure active screens →
          </div>
        </Link>

        {/* Stat 2: Assets */}
        <Link
          href="/contents"
          style={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "12px",
            padding: "1.5rem",
            textDecoration: "none",
            color: "inherit",
            transition: "border-color 0.2s, transform 0.2s",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: "0.875rem", color: "#71717a", fontWeight: 600 }}>CONTENT ASSETS</div>
          <div style={{ fontSize: "2.5rem", fontWeight: 800, color: "#ffffff", margin: "0.5rem 0" }}>
            {contents.length}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#10b981", fontWeight: 500 }}>
            Manage video library →
          </div>
        </Link>

        {/* Info Box */}
        <div
          style={{
            backgroundColor: "rgba(59, 130, 246, 0.05)",
            border: "1px dashed rgba(59, 130, 246, 0.2)",
            borderRadius: "12px",
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: "0.875rem", color: "#3b82f6", fontWeight: 600, marginBottom: "0.25rem" }}>
            ZERO-DATABASE DESIGNS
          </div>
          <p style={{ fontSize: "0.875rem", color: "#a1a1aa", margin: 0, lineHeight: "1.5" }}>
            Updating content here writes files instantly. Player reload resolves changes instantly.
          </p>
        </div>
      </div>

      {/* Main Panel: Active map */}
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          backgroundColor: "#18181b",
          border: "1px solid #27272a",
          borderRadius: "12px",
          padding: "1.5rem",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 1.5rem 0", color: "#ffffff" }}>
          Active Screen Status Map
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "180px 180px 1fr 120px",
              padding: "0.75rem 1rem",
              borderBottom: "1px solid #27272a",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#71717a",
            }}
          >
            <span>SCREEN NAME</span>
            <span>SCREEN ID</span>
            <span>ACTIVE CONTENT ID</span>
            <span style={{ textAlign: "right" }}>PORTAL</span>
          </div>

          {screens.map((screen: any) => (
            <div
              key={screen.screenId}
              style={{
                display: "grid",
                gridTemplateColumns: "180px 180px 1fr 120px",
                alignItems: "center",
                padding: "1rem",
                backgroundColor: "#09090b",
                borderRadius: "8px",
                border: "1px solid #27272a",
                fontSize: "0.875rem",
              }}
            >
              <span style={{ fontWeight: 600, color: "#ffffff" }}>{screen.screenName}</span>
              <span style={{ fontFamily: "monospace", color: "#a1a1aa" }}>{screen.screenId}</span>
              <span style={{ color: "#3b82f6", fontWeight: 600 }}>{screen.contentId}</span>
              <span style={{ textAlign: "right" }}>
                <a
                  href={`http://localhost:3001/${screen.screenId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: "#10b981",
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: "0.825rem",
                  }}
                >
                  Live Player ↗
                </a>
              </span>
            </div>
          ))}

          {screens.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "#71717a" }}>
              No active displays configured. Get started by adding a screen!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
