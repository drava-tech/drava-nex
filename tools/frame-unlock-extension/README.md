# CMS Platform — Frame Unlock

A small Chrome extension that makes the CMS **Browser** page able to open any
site, including Google and YouTube.

## Why this is needed

Most large sites send an `X-Frame-Options` or `Content-Security-Policy:
frame-ancestors` header telling browsers to refuse rendering them inside another
page. The browser enforces that itself, so no amount of server-side code can opt
out of it — the only two ways around it are to render the page on a server and
stream a picture of it, or to change the browser. This is the second option, and
it is by far the cheaper one.

With this installed, the Browser page's existing iframe simply works: real
pages, fully interactive, at native speed, with no rendering container and no
load on the server.

## Install (per machine)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (`tools/frame-unlock-extension`)

That's it. Reload the CMS and the Browser page will pick it up. Works in Chrome,
Edge and any other Chromium browser.

## Point it at your CMS

`manifest.json` → `content_scripts[0].matches` lists the CMS origin, currently
`localhost:3000` and `192.168.0.250:3000`. This only controls whether the
Browser page can tell the extension is installed (it hides the amber banner) —
the header rule itself works regardless.

After editing, hit **Reload** on the extension card in `chrome://extensions`.

## What it actually does

One `declarativeNetRequest` rule that strips the framing headers
(`X-Frame-Options`, `Content-Security-Policy`) from **sub-frame responses**.
Top-level navigation is untouched, so normal browsing in this profile keeps
every protection it had.

### Scope, stated plainly

The rule applies to any page loaded in a frame in this browser profile, not
only frames created by the CMS. Scoping it to the CMS origin via
`initiatorDomains` proved unreliable — Chrome silently discards the whole
ruleset if it rejects any part of a rule — so this trades a narrower blast
radius for actually working.

The practical effect: while this extension is enabled, a page in this profile
could frame a site that intended to forbid it. That is an acceptable trade on a
dedicated kiosk or a work laptop inside your building. It is **not** something
to install on a machine used for banking, email or anything you care about, and
not something to ship to machines you don't control.

Disable the extension when you're not using the Browser page if you want the
protection back — the toggle on the `chrome://extensions` card is enough.

`marker.js` sets a `data-cms-frame-unlock` attribute on the CMS page so the
Browser page knows the extension is present and can stop showing its install
prompt. It does nothing else and reads nothing from the page.

## Known limits

- A handful of sites detect framing in JavaScript rather than by header and
  bounce out of the frame. Nothing client-side fixes that; those still need
  "Open in a new tab".
- Sites that check the `Sec-Fetch-Dest: iframe` request header server-side can
  still refuse. That header is browser-controlled and extensions can't rewrite
  it reliably.
- Some login flows (OAuth consent screens in particular) intentionally refuse to
  run framed, and will keep refusing.
