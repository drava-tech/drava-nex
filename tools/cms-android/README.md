# EMS — Android shell

**EMS** (launcher name) is an Android app that opens the CMS admin dashboard full-screen on an office
tablet, with its own launcher icon and no browser chrome. Built with Capacitor.

Target server is set in `capacitor.config.ts`:

```ts
server: {
  url: 'https://192.168.1.250',
  ...
}
```

## Why a shell and not a real offline app

`apps/cms` is a Next.js SSR app. It has 15 `"use server"` action files, server
components that query Postgres directly through `@platform/db`, better-auth
server sessions, and an auth middleware. None of that can run on a phone —
there is no Node runtime, no database and no session server on the device. A
static export (`output: 'export'`) would strip every server action and every
DB-backed page, which is the entire product.

So this app does what `tools/main-screen-kiosk` does for the lobby TV, only for
Android: it is a native window around the CMS you already deploy. The CMS keeps
running on `ec-cms` exactly as before, and **nothing in `apps/cms` changes**.

## What it does

- Opens `https://192.168.1.250` full-screen, no URL bar, own launcher icon.
- **Trusts the LAN certificate silently.** nginx serves the CMS with a mkcert
  cert (`infra/nginx/certs/`), which Android trusts by default about as much as
  any browser does — not at all. `res/xml/network_security_config.xml` adds the
  mkcert root CA as a trust anchor for the CMS hosts *only*; every other domain
  still uses the system trust store. This is not a "ignore all TLS errors"
  switch.
- **Back navigates the CMS** instead of quitting the app. Capacitor 8 ships no
  native back handling at all — it forwards the press to the JS `App` plugin,
  whose bridge is never injected here (see "No plugins" below), so `MainActivity`
  registers its own `OnBackPressedCallback`.
- **Falls back to a branded offline page** (`www/index.html`) when a page fails
  to load, instead of Chrome's raw "webpage not available" screen. Wired up via
  Capacitor's `server.errorPath`, which is special-cased to be served from the
  APK's own assets even though `server.url` is remote.
- Declares `CAMERA` so `navigator.mediaDevices.getUserMedia` works — the CMS
  calls it in `apps/cms/src/hooks/useServerDetection.ts`. Capacitor's
  `BridgeWebChromeClient` raises the runtime prompt; the manifest entry is what
  makes that possible. `<input type="file">` (Media Library uploads) works
  through the same class with no extra permission.

### No plugins

`server.url` points at a remote origin, so Capacitor does **not** inject its JS
bridge into the pages. No Capacitor plugin will work here, by design — every
behaviour above is native config. Don't add `@capacitor/*` plugins expecting
them to work from CMS pages.

## Why the raw IP and not `ec-cms`

Android devices on this LAN do not reliably resolve the bare `ec-cms` hostname,
and a failed lookup looks identical to "the server is down". `192.168.1.250` is
a SAN on the mkcert leaf certificate and is already listed in
`BETTER_AUTH_TRUSTED_ORIGINS` and `CORS_ORIGIN` in `.env.production`, so login
works against it. `ec-cms` and `ec-cms.local` are still in `allowNavigation` and
in the network security config, so a link to either resolves in-app if a device
*can* resolve it.

## Prerequisites

- **A JDK between 17 and 24** — 21 recommended (`winget install
  EclipseAdoptium.Temurin.21.JDK`). Note that Android Studio's own bundled
  `jbr/` is **JDK 25**, which Gradle 8.14.3 refuses to run on; using it gives an
  "Unsupported class file major version" error. `scripts/gradle.mjs` finds a
  usable JDK for you and fails with a clear message if there is none, so
  `JAVA_HOME` does not have to be set globally.
- **Android SDK** with Platform 36 and Build-Tools 36.0.0. Either run Android
  Studio's setup wizard once, or install headlessly:

  ```
  sdkmanager "platform-tools" "platforms/android-36" "build-tools/36.0.0"
  ```

  `scripts/gradle.mjs` locates the SDK and writes `android/local.properties`
  (gitignored) itself.
- Node 24 (`.nvmrc` at the repo root).

This project is deliberately **outside** the pnpm workspace globs in
`pnpm-workspace.yaml`, so `turbo run build` and the Docker builds never try to
compile Android. It has its own lockfile — use **npm** here, not pnpm:

```
cd tools/cms-android
npm install
```

## Building

```
npm run build:release      # signed release apk
npm run build:debug        # debug apk, no keystore needed
npm run gradle -- <task>   # any other Gradle task, same environment
```

Output: `android/app/build/outputs/apk/release/EMS-release.apk` (~3.8 MB), or
`apk/debug/EMS-debug.apk` for a debug build. The file name comes from
`base.archivesName` in `android/app/build.gradle`.

Both build scripts run `npm run sync` first, which re-copies the root CA, points
the offline page at the current `server.url`, and reports how long the server
certificate is still valid. Run `npm run open` to work in Android Studio
instead.

Install on a tablet with `adb install -r <apk>`, or copy the file across and
open it (the tablet needs "install unknown apps" allowed for whatever opens it).

### Signing

`android/keystore.properties` (gitignored) holds the credentials; see
`android/keystore.properties.example` for the format. Without it,
`assembleRelease` still runs but produces an **unsigned** apk and logs a warning.

The current keystore is `E:/EC/keystores/ec-cms-release.jks` — RSA 4096, valid
~27 years, created with `keytool -genkeypair -keystore ec-cms-release.jks -alias
ec-cms -keyalg RSA -keysize 4096 -validity 10000`.

**Back up both the .jks and keystore.properties, off this machine.** If the
keystore is lost, no future build can update the app in place — every tablet
needs a manual uninstall and reinstall, and every installed copy is orphaned.

Check what a built apk is actually signed with:

```
apksigner verify --print-certs -v android/app/build/outputs/apk/release/EMS-release.apk
```

### Why `-Djava.net.preferIPv4Stack=true`

Set in both `android/gradle.properties` (for the Gradle daemon) and
`scripts/gradle.mjs` (for the wrapper's own client JVM, which runs before
`gradle.properties` is read). The JVM prefers IPv6 by default and then hangs
connecting to the GitHub-hosted Gradle distribution and to Maven repos until the
socket times out, while every other tool on the machine succeeds. Harmless on
IPv4-only and dual-stack networks; drop it only if building somewhere IPv6-only.
`gradle-wrapper.properties` also raises `networkTimeout` from Capacitor's 10s
default, which is far too tight for a ~200 MB download behind a redirect chain.

## Changing the server URL

Edit `server.url` in `capacitor.config.ts`, then `npm run build:release`. If the
new host isn't on the mkcert certificate, add it to the SANs and regenerate, or
the app will show a TLS error. `npm run sync` warns when the configured host is
not a SAN on `infra/nginx/certs/fullchain.pem`.

Add the host to `allowNavigation` too, or the WebView will hand it to the system
browser instead of loading it.

## Rotating the certificate

The current cert is valid until **2028-10-24**. When it is regenerated:

1. Regenerate `infra/nginx/certs/` with mkcert as usual and redeploy nginx.
2. If the **root CA** changed (not just the leaf), rebuild and reinstall this
   app — `npm run sync` re-copies `rootCA.crt` into `res/raw/`. A leaf-only
   rotation under the same CA needs no app rebuild.

An expired or untrusted cert breaks every installed tablet at once, and the
failure looks like a network fault, so `npm run sync` prints the expiry every
time.

## Icons and splash

`npm run assets` regenerates everything from `apps/cms/public/Logo.svg`:

1. `scripts/generate-assets.mjs` crops the red tusker glyph out of the logo
   lockup for the launcher icon (the full wordmark is far too wide to read at
   launcher size) and uses the whole lockup for the splash. The glyph is found
   by its brand red rather than by hard-coded coordinates, so a re-exported
   logo with different padding still crops correctly.
2. `capacitor-assets` fans those out into every density.
3. `scripts/fix-adaptive-icon.mjs` corrects the adaptive icon the generator
   writes — it insets the background layer by 16.7%, which leaves transparent
   edges a launcher reveals when it scales the icon. A flat colour background
   has no such margin.

## Known limitations

- **LAN only.** Off-site access needs the CMS on a real domain with a publicly
  trusted certificate, or a VPN.
- **Rebuild to repoint.** The server URL is baked in at build time.
- **Phone layout.** The dashboard is desktop-first. It is fine on a tablet; on a
  phone the sidebar shell and wider tables are cramped. Orientation is
  deliberately left unlocked so a phone build needs no manifest change.
- **The offline page also shows on HTTP errors.** Capacitor's `errorPath` fires
  on `onReceivedHttpError` as well as network failures, so a 404 from a mistyped
  CMS route lands on it too. The wording covers both cases.
