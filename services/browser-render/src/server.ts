import http from "node:http";
import puppeteer, { type Browser } from "puppeteer";
import { WebSocket } from "ws";
import { SessionManager } from "./sessions.js";
import type { ControlMessage } from "./protocol.js";

const WS_GATEWAY_URL = process.env["WS_GATEWAY_URL"] || "ws://api:4000/ws";
const BROADCAST_SECRET = process.env["BROADCAST_SECRET"] || "";
const MAX_SESSIONS = Number(process.env["MAX_SESSIONS"] || 8);
const HEALTH_PORT = Number(process.env["PORT"] || 8090);
const REMOTE_DEBUG_PORT = Number(process.env["REMOTE_DEBUG_PORT"] || 9222);

if (!BROADCAST_SECRET) {
  console.error("[browser-render] BROADCAST_SECRET is not set — the gateway will reject registration. Exiting.");
  process.exit(1);
}

let browser: Browser | null = null;
let sessions: SessionManager | null = null;
let control: WebSocket | null = null;
let registered = false;

async function launchBrowser(): Promise<Browser> {
  for (;;) {
    try {
      return await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          // Expose Chrome DevTools Protocol so any tab can be opened directly
          // in a real browser: chrome://inspect or http://localhost:REMOTE_DEBUG_PORT/json
          `--remote-debugging-port=${REMOTE_DEBUG_PORT}`,
          "--remote-debugging-address=0.0.0.0",
        ],
      });
    } catch (err) {
      console.error("[browser-render] Chromium launch failed, retrying in 5s:", (err as Error).message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ─── Control connection to the platform's /ws gateway ──────────────────────────
// Same reconnect-with-backoff shape as apps/api/audio-helper/bridge.mjs, which
// connects to the same gateway for the same reason (a first-party Node process
// outside the CMS/screens that needs to both receive commands and report status).

let reconnectDelay = 3000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_MAX_MS = 30_000;
const NACK_BACKOFF_MS = 30_000;

function sendControl(msg: ControlMessage | Record<string, unknown>): void {
  if (control && control.readyState === WebSocket.OPEN) {
    control.send(JSON.stringify(msg));
  }
}

function connect(): void {
  console.info(`[browser-render] Connecting to ${WS_GATEWAY_URL}...`);
  const sock = new WebSocket(WS_GATEWAY_URL);
  control = sock;

  sock.on("open", () => {
    console.info("[browser-render] WS connected, registering...");
    sock.send(JSON.stringify({ type: "BROWSER_RENDER_REGISTER", secret: BROADCAST_SECRET }));
  });

  sock.on("message", (raw) => {
    let msg: ControlMessage;
    try {
      msg = JSON.parse(raw.toString()) as ControlMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "BROWSER_RENDER_REGISTER_ACK":
        console.info("[browser-render] Registered with API.");
        registered = true;
        reconnectDelay = 3000;
        break;
      case "BROWSER_RENDER_REGISTER_NACK":
        console.error(
          `[browser-render] Registration rejected: ${msg.reason}. Check BROADCAST_SECRET matches the API's. Backing off ${NACK_BACKOFF_MS}ms.`
        );
        reconnectDelay = NACK_BACKOFF_MS;
        break;
      case "BROWSER_SESSION_START":
        void sessions?.start(msg);
        break;
      case "BROWSER_SESSION_STOP":
        void sessions?.stop(msg.sessionId);
        break;
      case "BROWSER_CONTROL":
        void sessions?.control(msg);
        break;
    }
  });

  sock.on("close", () => {
    registered = false;
    console.warn(`[browser-render] WS disconnected. Reconnecting in ${reconnectDelay}ms...`);
    scheduleReconnect();
  });

  sock.on("error", (err) => {
    console.error("[browser-render] WS error:", err.message);
    sock.close();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

/** Proxy a path from Chrome's own debug port back to the caller. */
function proxyJson(path: string, res: http.ServerResponse): void {
  http.get({ hostname: "127.0.0.1", port: REMOTE_DEBUG_PORT, path }, (r) => {
    let body = "";
    r.on("data", (c: Buffer) => { body += c.toString(); });
    r.on("end", () => { res.writeHead(200, CORS); res.end(body); });
  }).on("error", () => { res.writeHead(503, CORS); res.end("[]"); });
}

/** Open a new tab in the headless Chrome at the given URL.
 * Chrome CDP /json/new accepts PUT (newer) or GET (older) with the URL as raw query string. */
function openNewTab(targetUrl: string, res: http.ServerResponse): void {
  // PUT works on all recent Chromium versions; GET is the fallback for older ones.
  const req = http.request(
    { method: "PUT", hostname: "127.0.0.1", port: REMOTE_DEBUG_PORT, path: `/json/new?${targetUrl}` },
    (r) => {
      let body = "";
      r.on("data", (c: Buffer) => { body += c.toString(); });
      r.on("end", () => { res.writeHead(200, CORS); res.end(body); });
    }
  );
  req.on("error", () => { res.writeHead(503, CORS); res.end("null"); });
  req.end();
}

// ─── Health + browser UI endpoint ───────────────────────────────────────────────

const BROWSER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Headless Chrome</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#f0f0f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:2rem 1rem}
h1{font-size:1.4rem;font-weight:700;margin-bottom:1.5rem;background:linear-gradient(135deg,#3b82f6,#10b981);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
form{display:flex;gap:.5rem;width:100%;max-width:640px;margin-bottom:2rem}
input{flex:1;padding:.75rem 1rem;border-radius:9999px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:1rem;outline:none}
input:focus{border-color:#3b82f6}
button{padding:.75rem 1.5rem;border-radius:9999px;border:none;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer}
button:hover{background:#2563eb}
#tabs{width:100%;max-width:640px;display:flex;flex-direction:column;gap:.75rem}
.tab{background:#1a1a1a;border:1px solid #262626;border-radius:12px;padding:1rem 1.25rem}
.tab-title{font-weight:600;font-size:.95rem;margin-bottom:.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab-url{font-size:.75rem;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab-open{margin-top:.5rem;display:inline-block;font-size:.75rem;color:#3b82f6;text-decoration:none}
#status{margin-top:1rem;font-size:.85rem;color:#6b7280}
</style>
</head>
<body>
<h1>&#x1F310; Headless Chrome</h1>
<form id="nav">
  <input id="url" type="text" placeholder="https://example.com" value="https://www.google.com" autocomplete="off" spellcheck="false">
  <button type="submit">Open</button>
</form>
<div id="tabs"></div>
<div id="status">Loading...</div>
<script>
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
async function loadTabs(){
  try{
    const tabs=await fetch('/devtools').then(r=>r.json());
    const el=document.getElementById('tabs');
    const st=document.getElementById('status');
    el.innerHTML='';
    const pages=tabs.filter(t=>t.type==='page'&&t.url!=='about:blank');
    if(!pages.length){st.textContent='No tabs open yet — type a URL above and press Open.';return;}
    st.textContent=pages.length+' tab(s) open:';
    pages.forEach(t=>{
      const div=document.createElement('div');
      div.className='tab';
      div.innerHTML='<div class="tab-title">'+esc(t.title||t.url)+'</div>'
        +'<div class="tab-url">'+esc(t.url)+'</div>'
        +'<a class="tab-open" href="'+esc(t.devtoolsFrontendUrl)+'" target="_blank">Open in DevTools (Chrome desktop only) &#x2197;</a>';
      el.appendChild(div);
    });
  }catch(e){document.getElementById('status').textContent='Cannot reach browser service.';}
}
document.getElementById('nav').addEventListener('submit',async e=>{
  e.preventDefault();
  let raw=document.getElementById('url').value.trim();
  if(!/^https?:\/\//.test(raw))raw='https://'+raw;
  document.getElementById('status').textContent='Opening '+raw+'...';
  await fetch('/devtools/new?url='+encodeURIComponent(raw));
  setTimeout(loadTabs,800);
});
loadTabs();
setInterval(loadTabs,5000);
</script>
</body>
</html>`;

http
  .createServer((req, res) => {
    const url = req.url ?? "/";

    if (url === "/health") {
      res.writeHead(browser && registered ? 200 : 503, CORS);
      res.end(JSON.stringify({ ok: !!(browser && registered), sessions: sessions?.activeCount ?? 0 }));
      return;
    }

    // Proxy Chrome's /json tab list — uses the already-imported `http` module (no dynamic import)
    if (url === "/devtools" || url === "/devtools/") {
      proxyJson("/json", res);
      return;
    }

    // Open a new tab in headless Chrome: /devtools/new?url=https://...
    // ponytail: raw URL in query string — Chrome CDP /json/new doesn't want it encoded
    if (url.startsWith("/devtools/new")) {
      const target = new URL(url, "http://x").searchParams.get("url") ?? "https://www.google.com";
      openNewTab(target, res);
      return;
    }

    // /browser — HTML UI page; open http://<your-pc-ip>:8090/browser on your tablet
    if (url === "/browser" || url === "/browser/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(BROWSER_HTML);
      return;
    }

    res.writeHead(404, CORS);
    res.end(JSON.stringify({ ok: false }));
  })
  // 0.0.0.0 = accept connections from any device on the same network (tablet, phone, etc.)
  .listen(HEALTH_PORT, "0.0.0.0", () => {
    console.info(`[browser-render] Listening on :${HEALTH_PORT}`);
    console.info(`[browser-render] Browser UI → http://<your-pc-ip>:${HEALTH_PORT}/browser`);
  });

async function main(): Promise<void> {
  browser = await launchBrowser();
  console.info("[browser-render] Chromium launched.");
  sessions = new SessionManager({
    browser,
    wsGatewayUrl: WS_GATEWAY_URL,
    maxSessions: MAX_SESSIONS,
    sendControl,
  });
  connect();
}

void main();
