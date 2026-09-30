import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android WebView shell for the CMS admin dashboard.
 *
 * The CMS is a Next.js SSR app (server actions, direct Postgres access via
 * @platform/db, better-auth server sessions) — it cannot be bundled into the
 * APK. This app is a thin native shell that loads the deployed CMS, the same
 * way tools/main-screen-kiosk wraps /display on Windows.
 *
 * Because `server.url` points at a remote origin, Capacitor does NOT inject its
 * JS bridge into the pages — no Capacitor plugins work here, by design. Every
 * behaviour below is native config only; nothing in apps/cms changes.
 */
const config: CapacitorConfig = {
  appId: 'com.thewhitetusker.eccms',
  appName: 'CMS',
  webDir: 'www',
  server: {
    // Raw IP, not the `ec-cms` hostname: Android devices on this LAN do not
    // reliably resolve a bare NetBIOS/mDNS name. 192.168.1.250 is a SAN on the
    // mkcert leaf cert (infra/nginx/certs/fullchain.pem) and is already listed
    // in BETTER_AUTH_TRUSTED_ORIGINS and CORS_ORIGIN in .env.production, so
    // login works against it. Changing this needs a rebuild — see README.
    url: 'https://192.168.1.250',
    androidScheme: 'https',
    cleartext: false,
    // Keep the WebView pinned to the CMS. Anything else (an external link a
    // user taps) leaves for the system browser instead of loading in-app.
    allowNavigation: ['192.168.1.250', 'ec-cms', 'ec-cms.local'],
    // Bundled offline page (www/index.html), shown when a main-frame load
    // fails. Capacitor special-cases the error URL so it is served from the
    // APK's own assets even though server.url points at a remote origin
    // (WebViewLocalServer.isErrorUrl) — without this the WebView would fall
    // back to Chrome's raw "webpage not available" screen.
    errorPath: 'index.html',
  },
  android: {
    // The WebView paints white until the CMS's first frame lands, which reads
    // as a flash between the (dark) splash and the (dark) dashboard. Paint it
    // the brand navy instead — same value as the body gradient's top stop in
    // apps/cms/src/app/layout.tsx.
    backgroundColor: '#01001F',
    // Every client URL in the CMS is same-origin / protocol-relative, so an
    // https origin yields wss:// and https media — there is no mixed content
    // to allow. Flip this only if something genuinely http-only shows up.
    allowMixedContent: false,
    // Internal tool: keep chrome://inspect working on installed builds.
    webContentsDebuggingEnabled: true,
  },
};

export default config;
