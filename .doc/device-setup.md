# Device Setup — Pointing a TV or Tablet at the Platform

How to connect a **TV** (Chromium PC driving a screen) and a **tablet** (Android Chrome, used to
control the screens) to the platform host over the office LAN.

Assumes the stack is already deployed — see [`infrastructure.md`](./infrastructure.md) for that.
Throughout, the host is `ec-cms` at `192.168.1.250`; substitute your own.

---

## 1. Can devices reach it by IP?

**Yes.** `infra/nginx/default.conf` declares `server_name ec-cms 192.168.1.250;` on both the
`:80` and `:443` server blocks, so the raw IP and the hostname are equally valid. Devices that
can't resolve `ec-cms` on your LAN (phones and tablets often can't) should use the IP.

**But only those two names work.** A `default_server` block catches every other `Host` header
and returns **444** — nginx closes the connection with no response at all. The browser shows a
generic "this site can't be reached", which looks identical to the server being down.

> **If the host's LAN IP changes**, every device stops working with that unhelpful error until
> you add the new IP to `server_name` in `infra/nginx/default.conf` (both blocks) and reload
> nginx. Give the host a DHCP reservation or a static lease to avoid this.

---

## 2. The http/https split — read this before anything else

This deployment deliberately serves some paths over plain http and forces others to https.
Most setup failures come from using the wrong scheme.

| Path | On `:80` (http) | On `:443` (https) |
|---|---|---|
| `/display/*` — the TV player | **served directly** | served directly |
| `/media/*` — uploaded images/video | served directly | served directly |
| `/api/*` (except auth), `/ws`, `/health` | served directly | served directly |
| `/api/auth/*` — login/session | **301 → https** | served directly |
| `/` — admin dashboard, `/screens/*` | **301 → https** | served directly |

**Why:** better-auth issues `Secure` / `__Secure-` prefixed cookies because its `baseURL` is
https. Browsers silently refuse to store those over plain http, which produces a login that
appears to succeed and then bounces straight back to `/login`, forever. Forcing the
session-bearing routes to https is what prevents that.

**Why displays stay on http:** `/display` is public and unauthenticated — it is in the
pass-through list in `apps/cms/src/middleware.ts`, so it needs no cookie — and TVs have no
reason to be taught to trust a private certificate authority.

---

## 3. TV — Chromium PC

### 3.1 Create the screen first

The last URL segment **is** the screen id. `/display/main-TV` looks up a screen with id
`main-TV` (`resolveDisplayConfig()` in `apps/cms/src/lib/display/display-config.ts`); an
unknown id renders a 404. Create the screen in the CMS before pointing the TV at it.

### 3.2 Open the display

```
http://192.168.1.250/display/main-TV
```

- **http, not https.** No login prompt — the route is public.
- **Do not use `https://` here.** Both schemes serve `/display`, but on an https page the
  browser blocks every `http://` URL a client pastes into the media library as *mixed content*:
  the iframe is simply blank, with no error visible on the TV and nothing in the CMS to explain
  it. This is the most likely way this setup breaks in the field.

### 3.3 Install Frame Unlock

Most large sites send `X-Frame-Options` or `Content-Security-Policy: frame-ancestors`, which
tells the browser to refuse rendering them inside a frame. The browser enforces that itself, so
no server-side change can opt out. The extension in `tools/frame-unlock-extension` strips those
headers from sub-frame responses.

1. `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select `tools/frame-unlock-extension`

Without it, a pushed web page that sends those headers stays blank on this TV.

Two notes:

- The manifest's `content_scripts.matches` covers `https://ec-cms/*` and
  `https://192.168.1.250/*`, but **not** the http display origin — so the
  `data-cms-frame-unlock` marker isn't set on the display page. That is harmless: the marker
  only hides the install banner on the CMS admin's Browser page. The header-stripping
  `declarativeNetRequest` rule is origin-independent and applies to every frame in the profile.
- Read the scope warning in [`tools/frame-unlock-extension/README.md`](../tools/frame-unlock-extension/README.md).
  The rule weakens framing protection for the **whole browser profile**, not just our pages.
  That is an acceptable trade on a dedicated signage machine; don't install it on a laptop used
  for email or banking.

### 3.4 Kiosk launch flags

```
chrome.exe --kiosk "http://192.168.1.250/display/main-TV" ^
  --autoplay-policy=no-user-gesture-required ^
  --noerrdialogs ^
  --disable-session-crashed-bubble ^
  --disable-features=Translate
```

`--autoplay-policy=no-user-gesture-required` is **required**, not cosmetic: the kiosk branch of
`mediaEmbedUrl()` in `packages/types/src/media-content.ts` requests unmuted YouTube autoplay,
which the default policy blocks — the video would sit on its first frame forever.

### 3.5 Touch panels

If the TV has a touch panel, pages embedded on the display are scrollable: the display page pins
`touch-action: none` to stop passers-by panning the signage, and `HtmlRenderer` relaxes it only
while an embedded page is on screen, restoring it afterwards.

---

## 4. Tablet — Android Chrome

The tablet has two possible roles. Be clear which one you want, because the URLs differ:

| Role | URL |
|---|---|
| Admin / screen control | `https://192.168.1.250` |
| A second display | `http://192.168.1.250/display/<screenId>` |

As a display, follow §3 exactly. For the admin role, the https requirement means certificates:

### 4.1 Generate certificates on the host

`infra/nginx/certs/` is **not in the repo** — but `docker-compose.yml` mounts it and the `:443`
server block references `fullchain.pem` and `privkey.pem`. Without them nginx will not start.

Using [mkcert](https://github.com/FiloSottile/mkcert) on the host:

```bash
mkcert -install
mkcert -cert-file fullchain.pem -key-file privkey.pem ec-cms 192.168.1.250 localhost 127.0.0.1
```

Put both files in `infra/nginx/certs/` and restart nginx.

**The IP must be in that name list.** Chrome rejects a certificate whose SAN doesn't cover the
address in the URL bar, even when the issuing CA is fully trusted. Verify with:

```bash
openssl x509 -in fullchain.pem -noout -text | grep -A1 "Subject Alternative Name"
```

### 4.2 Trust the CA on the tablet

Copy `rootCA.pem` from the directory `mkcert -CAROOT` prints, then on the tablet:

**Settings → Security → Encryption & credentials → Install a certificate → CA certificate**

Android warns that "your network may be monitored" — that is the standard message for any
privately-installed CA and is expected here.

Without this step the tablet shows "Your connection is not private" on every admin page load.

### 4.3 Match the auth origin

`apps/cms/src/lib/auth.ts` reads `BETTER_AUTH_URL` into **both** better-auth's `baseURL` and its
`trustedOrigins`. If it doesn't match the origin the tablet actually uses, login loops.

On the host's `.env.production`:

```
BETTER_AUTH_URL=https://ec-cms
BETTER_AUTH_TRUSTED_ORIGINS=https://192.168.1.250,https://ec-cms
CORS_ORIGIN=https://ec-cms,https://192.168.1.250
```

List every origin any device will use. Check the current values on the host before changing
anything — `.env.production` is gitignored, so it is not visible from a clone.

---

## 5. Verify the setup

On the host:

- [ ] `infra/nginx/certs/fullchain.pem` exists and its SAN list includes `192.168.1.250` (§4.1)
- [ ] `.env.production` auth origins use `https://` and list every device origin (§4.3)

From the devices:

- [ ] TV: `http://192.168.1.250/display/main-TV` loads with no login prompt
- [ ] TV: push a site that blocks framing (e.g. `google.com`) from the media library — it renders
      with Frame Unlock enabled, and goes blank when you disable the extension
- [ ] TV: a YouTube link plays automatically without being clicked (confirms the autoplay flag)
- [ ] Tablet: `https://192.168.1.250` shows the login page with no certificate warning
- [ ] Tablet: log in, then reload — the session survives (confirms the auth origins)

---

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| "Site can't be reached", connection closed immediately | The `Host` used isn't in `server_name`, so the `default_server` returned 444. Use `ec-cms` or the exact IP (§1) |
| Login succeeds, then bounces back to `/login` | `BETTER_AUTH_URL` scheme/origin doesn't match the URL the device used — the `__Secure-` cookie was dropped (§4.3) |
| Embedded page blank on the TV, nothing in the logs | Either the display is on `https://` and the link is `http://` (mixed content, §3.2), or the site sends `X-Frame-Options` and Frame Unlock isn't installed (§3.3) |
| "Your connection is not private" on the tablet | mkcert root CA not installed (§4.2), or the IP is missing from the certificate's SAN list (§4.1) |
| YouTube shows its first frame and never starts | Chromium launched without `--autoplay-policy=no-user-gesture-required` (§3.4) |
| Everything 502s after recreating containers | nginx caches the old container IPs — restart the nginx container after recreating app containers |
| A handful of sites stay blank even with Frame Unlock | Some sites detect framing in JavaScript and bail out; no extension can stop that. Those need "Open in a new tab" |

---

## See also

- [`networking.md`](./networking.md) — full port registry and nginx routing
- [`environment.md`](./environment.md) — every environment variable
- [`infrastructure.md`](./infrastructure.md) — deploying the stack itself
- [`../tools/frame-unlock-extension/README.md`](../tools/frame-unlock-extension/README.md) — what the extension does and its scope
