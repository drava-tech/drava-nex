"""Run the benchmark's mock CMS as a stand-alone server, so Travis can be tried by voice without touching the real CMS.

    python -m bench.mock_cms_server [--port 4010] [--no-portfolio]
    CMS_API_BASE_URL=http://127.0.0.1:4010 CMS_VOICE_SECRET=bench-secret python main.py

It has the benchmark's fake room (lights, AC, door, the screens "tusker 86" and "tusker 27", a few experiences) plus a
"White Tusker Portfolio" experience, so Travis's portfolio offer can be played through. Nothing real is switched or shown: every
request it receives is printed here, which is how you see what Travis would have done.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bench.voice_bench import names  # noqa: E402
from bench.voice_bench.mock_cms import SECRET, MockCms  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4010)
    ap.add_argument("--no-portfolio", action="store_true", help="leave the portfolio experience out (Travis then makes no offer)")
    args = ap.parse_args()
    if not args.no_portfolio and not any("portfolio" in e["title"].lower() for e in names.EXPERIENCES):
        names.EXPERIENCES.append({"id": "exp-portfolio", "title": "White Tusker Portfolio"})
    cms = MockCms(port=args.port).start()
    print(f"mock CMS on {cms.url}  (secret: {SECRET}); experiences: {[e['title'] for e in names.EXPERIENCES]}", flush=True)
    seen = 0
    try:
        while True:
            time.sleep(0.3)
            for call in cms.calls_since(seen):
                body = call.get("body")
                print(f"{time.strftime('%H:%M:%S')}  {call['method']} {call['path']}  {body if body else ''}", flush=True)
            seen = cms.snapshot()
    except KeyboardInterrupt:
        cms.stop()


if __name__ == "__main__":
    main()
