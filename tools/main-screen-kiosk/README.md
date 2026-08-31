# CMS Platform — Main Screen Kiosk

A small Windows app (.NET 8 WPF + WebView2) that opens a CMS display page
full-screen on a lobby TV's PC, with no browser chrome, and lets the CMS
remotely minimize, restore, or close it. There is no local minimize/close UI
on the kiosk itself — that control lives exclusively on the CMS tablet, so
nobody can accidentally minimize or close the display by touching the TV.

Target page is hardcoded in `MainWindow.xaml.cs`:

```csharp
private const string TargetUrl = "https://ec-cms/display/main-screen";
private const string TrustedHost = "ec-cms";
```

## Why not just launch a browser in kiosk mode

A plain `msedge --kiosk <url>` shortcut can't be remote-controlled from the
CMS, can't silently trust `ec-cms`'s self-signed cert without a one-time
manual click-through, and F11/`--kiosk` fullscreen is invisible to page
JavaScript (the existing 5-tap fullscreen escape hatch in
`apps/cms/src/app/display/_components/FiveTapCorner.tsx` only works against
fullscreen *this app* enters itself). This app owns all of that instead.

## What it does

- Opens `TargetUrl` maximized, borderless, always-on-top, not in the taskbar —
  a real fullscreen kiosk, not just a maximized window.
- Silently trusts `TrustedHost`'s TLS certificate (self-signed on a bare LAN
  hostname/IP) without showing WebView2's warning interstitial. Only that one
  host is trusted, not every certificate error.
- Auto-retries navigation every 5s if the page fails to load or the WebView2
  process crashes, so a brief network blip or backend restart doesn't leave
  the TV stuck on an error page.
- Blocks Escape/F11/Alt+F4 from a keyboard. `Ctrl+Shift+Alt+X` is a hidden
  escape hatch for maintenance.
- Listens for `window.chrome.webview.postMessage("minimize" | "maximize" |
  "close")` from the page, but only when it's actually served from
  `TrustedHost` — see "CMS integration" below.
- Auto-installs the [Frame Unlock extension](../frame-unlock-extension/README.md)
  into its own WebView2 profile at startup (best-effort, non-fatal) — see
  "Frame Unlock extension" below.

## CMS integration

The CMS's per-screen control page (`/screens/<screenId>`,
`apps/cms/src/components/live-screen-surface.tsx`) has **Minimize**,
**Maximize**, and **Close app** buttons that send the
`APP_MINIMIZE`/`APP_MAXIMIZE`/`APP_CLOSE` remote commands (`sendRemoteCommand`
→ `POST /api/screens/:id/command` → WS gateway → screen — the same generic
plumbing `RELOAD`/`MUTE`/etc. already use). This is the **only** way to
minimize or close the kiosk — there's deliberately no on-screen button for it
on the TV itself.

`apps/cms/src/app/display/_components/LiveScreenPlayer.tsx` receives those
commands on the display page and forwards them into this app via
`window.chrome.webview.postMessage(...)` — a no-op in a regular browser tab,
since `window.chrome.webview` only exists inside this app's WebView2 host.

**This only works when the CMS control page and the kiosk are talking to the
same backend.** The kiosk always connects to whatever `TargetUrl` points at
(`ec-cms`) — testing Minimize/Maximize/Close from a `localhost` CMS instance
won't do anything, since that's a separate server process with its own list
of which screens are currently connected. Test from the same host the kiosk
is actually pointed at.

## Build

Requires the .NET 8 SDK.

```
cd tools/main-screen-kiosk
dotnet build
```

## Publish (standalone .exe)

```
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

Output: `bin/Release/net8.0-windows/win-x64/publish/MainScreenKiosk.exe` — a
single self-contained file (~160MB), no .NET runtime needed on the target
machine. `bin/` and `obj/` aren't committed; publish on (or copy the
published output to) the machine you're deploying to.

## Deploy on the TV's PC

1. Copy the **entire** `publish` folder's contents to the machine — not just
   `MainScreenKiosk.exe` anymore. The `frame-unlock-extension/` subfolder next
   to it is required at every launch (see below), not just debug symbols/docs.
2. For auto-start on login/reboot, add a shortcut to `MainScreenKiosk.exe` in:
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`

### Scripted deploy (`deploy.ps1`)

`deploy.ps1` automates the publish + copy + relaunch cycle above over the LAN,
so you don't have to sneakernet a USB drive to the TV's PC every time this app
changes:

```powershell
./deploy.ps1 -ComputerName <kiosk PC's hostname or IP> -RemotePath 'C:\MainScreenKiosk'
```

It publishes, mirrors the publish folder to `\\<ComputerName>\C$\...` via
`robocopy /MIR`, and (best-effort, needs PowerShell Remoting/WinRM enabled on
the target) stops the old process before copying and starts the new one
after. If remoting isn't set up there, the copy still happens — you'll just
need to relaunch the app on that PC by hand (or reboot it) afterwards. Pass
`-Credential (Get-Credential)` if the kiosk PC needs different credentials
than your own session, `-SkipPublish` to redeploy the last build without
rebuilding, or `-SkipRestart` to only copy files. See the script's own
comment-based help (`Get-Help ./deploy.ps1 -Full`) for every parameter.

## Frame Unlock extension

Most large sites send `X-Frame-Options`/CSP headers that make the pages this
app frames (via the CMS Browser feature) show a "blocked" icon instead of
rendering. Since this kiosk has no browser chrome, there's no `chrome://extensions`
page to manually install a fix into — so on startup, `MainWindow.xaml.cs`
loads [`../frame-unlock-extension`](../frame-unlock-extension/README.md)
straight into its own WebView2 profile via `CoreWebView2Profile.AddBrowserExtensionAsync`,
using the folder shipped alongside the exe (see the `.csproj`'s `Content`
item). This is:

- **Idempotent** — checked by extension name before adding, so relaunching or
  rebooting the kiosk doesn't re-add it every time.
- **Best-effort** — a missing folder, or an installed WebView2 Runtime too old
  to support extensions, is swallowed silently; the kiosk still starts and
  navigates normally either way, just without the header-stripping.
