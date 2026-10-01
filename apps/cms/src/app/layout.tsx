import '@platform/ui/globals.css';
import React from 'react';
import type { Viewport } from 'next';
import { ThemeProvider } from '../components/theme-provider';

// Pinned so a touch device (the remote-control tablet, notably) can't pinch-
// or double-tap-zoom the page — without this, a two-finger gesture on the
// screen touchpad is ambiguous between "scroll the remote screen" and
// "zoom this page" in many mobile browsers, regardless of the pad's own
// touch-action CSS (which only governs that one element, not page-level zoom
// chrome). See ScreenTouchpad.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Satoshi (Fontshare CDN) — used for experience pill names */}
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
