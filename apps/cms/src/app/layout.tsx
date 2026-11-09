import '@platform/ui/globals.css';
import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import { ThemeProvider } from '../components/theme-provider';

// drava type, as in Drava Core: Inter for everything you read, Archivo
// Expanded (stand-in for the brand's Aktiv Grotesk Extended) for headings.
// globals.css maps them to --font-sans and --font-heading.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const archivoExpanded = localFont({
  src: [
    { path: '../assets/fonts/ArchivoExpanded-Regular.ttf', weight: '400' },
    { path: '../assets/fonts/ArchivoExpanded-Medium.ttf', weight: '500' },
    { path: '../assets/fonts/ArchivoExpanded-SemiBold.ttf', weight: '600' },
    { path: '../assets/fonts/ArchivoExpanded-Bold.ttf', weight: '700' },
  ],
  variable: '--font-archivo-expanded',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Drava Nex',
};

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
    // Font variables on <html>: globals.css resolves --font-sans/--font-heading
    // on :root, which is <html>, so they must be defined there.
    <html lang="en" className={`${inter.variable} ${archivoExpanded.variable}`} suppressHydrationWarning>
      <head>
        {/* Satoshi (Fontshare CDN) — used for experience pill names */}
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-foreground antialiased">
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
