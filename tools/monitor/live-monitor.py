#!/usr/bin/env python3
"""
Live view of what one client is actually experiencing, read from nginx's access
log (the `timed` format carries rt= total and urt= upstream time per request).

  rt  = how long the whole request took, including pushing bytes to the client
  urt = how long the SERVER took to answer

So urt is "how fast is my data", and a large rt with a small urt is network or
client-side download time, not the backend being slow.

Usage:
  python live-monitor.py            # live, refreshes every 5s
  python live-monitor.py --once     # one snapshot
  python live-monitor.py --window 300
"""
import argparse, re, subprocess, sys, time
from collections import defaultdict

CLIENT = "TB330FU"          # the Android tablet; change to watch a different client
LINE = re.compile(
    r'^(\S+) \[([^\]]+)\] "(\S+) ([^"]*?) [^"]*" (\d{3}) (\d+) rt=([\d.]+) urt=([\d.-]+) "(.*)"$'
)

def classify(path):
    if path.startswith("/ws"):                              return "websocket"
    if re.search(r"\.(mp4|webm|mov|m4v)(\?|$)", path):       return "video"
    if path.startswith("/media/"):                          return "media"
    if path.startswith("/api/"):                            return "api"
    if path.startswith("/_next/"):                          return "assets"
    return "page"

def pct(vals, p):
    if not vals: return 0.0
    s = sorted(vals)
    return s[min(int(len(s) * p / 100), len(s) - 1)]

def collect(window):
    raw = subprocess.run(
        ["docker", "logs", "cms-nginx", "--since", f"{window}s"],
        capture_output=True, text=True, errors="replace"
    )
    rows = []
    for ln in (raw.stdout + raw.stderr).splitlines():
        m = LINE.match(ln.strip())
        if not m: continue
        _, ts, method, path, status, size, rt, urt, ua = m.groups()
        if CLIENT not in ua: continue
        rows.append({
            "method": method, "path": path, "status": int(status),
            "bytes": int(size), "rt": float(rt),
            "urt": float(urt) if urt not in ("-", "") else None,
            "kind": classify(path),
        })
    return rows

def api_health():
    def d(fmt):
        return subprocess.run(["docker", "inspect", "cms-api", "--format", fmt],
                              capture_output=True, text=True).stdout.strip()
    started = d("{{.State.StartedAt}}")[:19].replace("T", " ")
    crashes = subprocess.run(
        ["docker", "logs", "cms-api"], capture_output=True, text=True, errors="replace")
    out = crashes.stdout + crashes.stderr
    return started, out.count("ReadableStream is already closed"), out.count("[fatal]")

def render(window):
    rows = collect(window)
    by = defaultdict(list)
    for r in rows: by[r["kind"]].append(r)

    print("\033[2J\033[H", end="")
    print(f"  LIVE - Android tablet ({CLIENT})        last {window}s        {time.strftime('%H:%M:%S')}")
    print("  " + "-" * 74)

    if not rows:
        print("\n  No requests from the tablet in this window.")
        print("  (open the app, or check it is on the same network)\n")
    else:
        print(f"  {'CATEGORY':<11} {'REQS':>5} {'SERVER p50':>11} {'p95':>8} {'SLOWEST':>9} {'BYTES':>10}  ERR")
        for kind in ("page", "api", "assets", "media", "video", "websocket"):
            rs = by.get(kind)
            if not rs: continue
            urts = [r["urt"] for r in rs if r["urt"] is not None and kind != "websocket"]
            mb   = sum(r["bytes"] for r in rs) / 1048576
            errs = sum(1 for r in rs if r["status"] >= 400)
            p50  = f"{pct(urts,50)*1000:.0f}ms" if urts else "-"
            p95  = f"{pct(urts,95)*1000:.0f}ms" if urts else "-"
            mx   = f"{max(urts)*1000:.0f}ms"    if urts else "-"
            flag = "  !" if errs else ""
            print(f"  {kind:<11} {len(rs):>5} {p50:>11} {p95:>8} {mx:>9} {mb:>9.1f}M  {errs}{flag}")

        # -- Is the UI being starved by media? --
        vid_mb  = sum(r["bytes"] for r in by.get("video", [])) / 1048576
        data_mb = sum(r["bytes"] for r in rows) / 1048576 - vid_mb
        print("\n  " + "-" * 74)
        print(f"  Video bytes   {vid_mb:8.1f} MB      App bytes {data_mb:7.2f} MB", end="")
        if vid_mb > 20:
            print(f"   <- still streaming originals; RELOAD the app")
        else:
            print("   OK healthy")

        slow = [r for r in rows if r["urt"] and r["urt"] > 0.5
                and r["kind"] not in ("video", "websocket", "media")]
        if slow:
            print(f"\n  SLOW SERVER RESPONSES (>500ms, excluding video):")
            for r in sorted(slow, key=lambda x: -x["urt"])[:5]:
                print(f"    {r['urt']*1000:7.0f}ms  {r['method']} {r['path'][:52]}")

        bad = [r for r in rows if r["status"] >= 400]
        if bad:
            print(f"\n  ERRORS / ABORTS:")
            seen = defaultdict(int)
            for r in bad: seen[(r["status"], r["path"][:46])] += 1
            for (st, p), n in sorted(seen.items(), key=lambda x: -x[1])[:5]:
                print(f"    {st} x{n:<3} {p}")

    started, rs_crashes, fatals = api_health()
    print("\n  " + "-" * 74)
    print(f"  API up since {started}   stream-crashes {rs_crashes}   caught-fatals {fatals}")
    if rs_crashes:
        print("  ! the stream crash is BACK - screens will be resetting to idle")
    print()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--window", type=int, default=60)
    a = ap.parse_args()
    try:
        while True:
            render(a.window)
            if a.once: break
            time.sleep(5)
    except KeyboardInterrupt:
        print("stopped")
