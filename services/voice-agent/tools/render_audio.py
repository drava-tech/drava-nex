"""Pre-render the spoken answers (knowledge/faq.yaml, knowledge/smalltalk.yaml) with the current ElevenLabs voice.

    python -m tools.render_audio                 # CHECK only (default): what would be rendered, how many characters, the ElevenLabs quota left
    python -m tools.render_audio --render        # render what is missing; refuses if it would use more than 20% of the quota left
    python -m tools.render_audio --render --force   # ...even if it is more than that (ask the owner first)
    python -m tools.render_audio --include-drafts   # count/render the entries still marked draft too (an estimate before review is finished)

Only entries whose status is approved are rendered (or draft too with --include-drafts). Files are stored in cache/tts/ by a hash of the exact
text, voice, model and sample rate (agent/audio_cache.py), so re-running after the knowledge files change renders only what is new or changed.
The check reads the quota with one GET and renders nothing. The API key is read from config/api_keys.json and never printed.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import requests

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from agent.audio_cache import AudioCache  # noqa: E402
from agent.canned_route import AUDIO_DIR, DEFAULT_CONTACT_LINE, FAQ_PATH, SMALLTALK_PATH  # noqa: E402
from agent.vocabulary import speakable  # noqa: E402
from nlu import canned  # noqa: E402
from nlu.spoken_names import say_names  # noqa: E402
from settings import RECEIVE_SAMPLE_RATE, load_api_config  # noqa: E402

API = "https://api.elevenlabs.io/v1"
MAX_SHARE = 0.20
VOICE_SETTINGS = {"stability": 0.5, "similarity_boost": 0.8}  # the same as the live streaming session (speech/elevenlabs_stream.py)


def texts_to_render(statuses: tuple[str, ...], cfg: dict) -> list[str]:
    """Every distinct spoken text of the entries, exactly as the agent will look it up (names said as visitors say them, contact line added)."""
    line = str(cfg.get("company_contact_line") or DEFAULT_CONTACT_LINE)
    seen: dict[str, None] = {}
    for e in canned.load_entries(Path(cfg.get("faq_path") or FAQ_PATH), Path(cfg.get("smalltalk_path") or SMALLTALK_PATH), statuses):
        for answer in e.answers:
            text = f"{answer} {line}" if e.add_email_line else answer
            seen[say_names(speakable(text))] = None
    return list(seen)


def quota(key: str) -> tuple[int, int]:
    """(characters used, character limit) from the ElevenLabs subscription. One GET; nothing is spent."""
    r = requests.get(f"{API}/user/subscription", headers={"xi-api-key": key}, timeout=15)
    r.raise_for_status()
    d = r.json()
    return int(d["character_count"]), int(d["character_limit"])


def render_one(key: str, voice: str, model: str, text: str) -> bytes:
    r = requests.post(
        f"{API}/text-to-speech/{voice}", params={"output_format": f"pcm_{RECEIVE_SAMPLE_RATE}"},
        headers={"xi-api-key": key, "content-type": "application/json"},
        json={"text": text, "model_id": model, "voice_settings": VOICE_SETTINGS}, timeout=60)
    r.raise_for_status()
    return r.content


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--render", action="store_true", help="render what is missing (default: only check)")
    ap.add_argument("--force", action="store_true", help="render even if it would use more than 20%% of the quota left")
    ap.add_argument("--include-drafts", action="store_true", help="also count/render entries whose status is still draft")
    args = ap.parse_args()

    cfg = load_api_config()
    key, voice = str(cfg.get("elevenlabs_api_key") or "").strip(), str(cfg.get("elevenlabs_voice_id") or "").strip()
    model = str(cfg.get("elevenlabs_model_id") or "eleven_flash_v2_5").strip()
    if not key or not voice:
        print("No ElevenLabs key or voice id in config/api_keys.json.")
        return 2
    statuses = ("approved", "approve", "draft") if args.include_drafts else canned.APPROVED
    texts = texts_to_render(statuses, cfg)
    cache = AudioCache(Path(cfg.get("tts_cache_dir") or AUDIO_DIR), voice, model, RECEIVE_SAMPLE_RATE)
    missing = [t for t in texts if not cache.has(t)]
    need = sum(len(t) for t in missing)
    print(f"{len(texts)} spoken answers ({', '.join(statuses)}): {len(texts) - len(missing)} already rendered, {len(missing)} to render, "
          f"{need} characters needed (voice {voice[:6]}..., model {model}, {RECEIVE_SAMPLE_RATE} Hz).")
    try:
        used, limit = quota(key)
    except Exception as e:  # noqa: BLE001
        code = getattr(getattr(e, "response", None), "status_code", None)
        why = ""
        if code in (401, 403):
            why = " The key is not allowed to read the subscription (a restricted key needs the \"user_read\" permission); check the quota on the ElevenLabs dashboard."
        print(f"Could not read the ElevenLabs quota ({type(e).__name__}{f', HTTP {code}' if code else ''}).{why} Not rendering.")
        return 3
    left = limit - used
    share = need / left if left > 0 else float("inf")
    print(f"ElevenLabs quota: {used} of {limit} characters used, {left} left. This render would use {100 * share:.1f}% of what is left.")
    if not args.render:
        print("Check only: nothing was rendered. Re-run with --render once you have approved this.")
        return 0
    if not missing:
        print("Nothing to render.")
        return 0
    if share > MAX_SHARE and not args.force:
        print(f"Refusing: more than {int(MAX_SHARE * 100)}% of the quota left. Ask the owner, then re-run with --force.")
        return 4
    for i, text in enumerate(missing, 1):
        cache.store(text, render_one(key, voice, model, text))
        print(f"  [{i}/{len(missing)}] {len(text)} chars: {text[:60]}")
        time.sleep(0.2)
    print("Done. The agent plays these instead of synthesising them live.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
