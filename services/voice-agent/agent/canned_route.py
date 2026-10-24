"""FAQ and small-talk answers (nlu/canned.py) in the conversation: spoken from the written text, from pre-rendered audio when there is some.

Runs in agent/commands.py after the fast path, pending questions and self-corrections, before the planner and the relevance gate. A request
that does not match returns None and goes on exactly as before. Nothing here talks to the CMS.
"""

from __future__ import annotations

import asyncio
import os
import random
from pathlib import Path

from agent.audio_cache import AudioCache
from agent.turn import is_stale
from agent.vocabulary import speakable
from nlu import canned
from nlu.spoken_names import say_names
from rag import retriever
from settings import BASE_DIR, RECEIVE_SAMPLE_RATE, load_api_config

FAQ_PATH = BASE_DIR / "knowledge" / "faq.yaml"
SMALLTALK_PATH = BASE_DIR / "knowledge" / "smalltalk.yaml"
INDEX_CACHE = BASE_DIR / "cache" / "canned_index.npz"
AUDIO_DIR = BASE_DIR / "cache" / "tts"
DEFAULT_CONTACT_LINE = "You can reach us at hello at thewhitetusker dot com."


class CannedMixin:
    _canned_matcher = None
    _canned_tried = False
    _canned_last: dict | None = None
    _jokes_used: set | None = None
    _audio_cache: AudioCache | None = None

    def _canned_setup(self):
        """Build the matcher once (embeds every variant of the approved entries; cached on disk by content hash)."""
        self._canned_tried = True
        self._canned_last, self._jokes_used = {}, set()
        cfg = load_api_config()
        if not cfg.get("canned_enabled", True):
            return
        # TRAVIS_CANNED_STATUSES=draft,approved (measurements and bench runs only): include entries that are still drafts
        env = os.environ.get("TRAVIS_CANNED_STATUSES")
        statuses = tuple(s.strip() for s in env.split(",") if s.strip()) if env else tuple(cfg.get("canned_statuses") or canned.APPROVED)
        entries = canned.load_entries(Path(cfg.get("faq_path") or FAQ_PATH), Path(cfg.get("smalltalk_path") or SMALLTALK_PATH), statuses)
        if not entries:
            return
        self._canned_matcher = canned.CannedMatcher(
            entries, canned.embedder_from_ollama(), threshold=float(cfg.get("canned_threshold", 0.82)), margin=float(cfg.get("canned_margin", 0.04)),
            min_fuzzy=float(cfg.get("canned_min_fuzzy", 0.4)), cache_path=INDEX_CACHE,
        )
        voice, model = str(cfg.get("elevenlabs_voice_id") or ""), str(cfg.get("elevenlabs_model_id") or "eleven_flash_v2_5")
        self._audio_cache = AudioCache(Path(cfg.get("tts_cache_dir") or AUDIO_DIR), voice, model, RECEIVE_SAMPLE_RATE)
        print(f"[Voice Agent] 💬 {len(entries)} written-down answers loaded ({', '.join(statuses)}).")

    async def _try_canned(self, request: str) -> str | None:
        """The spoken reply if `request` is a written-down question or small talk; None if not (or if anything fails: the normal route answers)."""
        try:
            if not self._canned_tried:
                await asyncio.get_running_loop().run_in_executor(None, self._canned_setup)
            if self._canned_matcher is None:
                return None
            hit = await asyncio.get_running_loop().run_in_executor(None, self._canned_matcher.match, request, self._device_words())
        except Exception as e:
            print(f"[Voice Agent] ⚠️ Written-down answers unavailable: {e}")
            return None
        if hit is None:
            return None
        entry = hit.entry
        self._new_conversation_check()
        text = canned.pick_answer(entry, self._canned_last, self._jokes_used, random.Random())
        if entry.add_email_line:
            text = f"{text} {load_api_config().get('company_contact_line') or DEFAULT_CONTACT_LINE}"
        self._path = {"faq": "faq", "no_info": "faq (no info)", "smalltalk": "small talk"}[entry.kind]
        self._plan_log = {"canned": {"entry": entry.id, "kind": entry.kind, "score": round(hit.score, 3), "margin": round(hit.margin, 3), "variant": hit.variant}}
        print(f"[Voice Agent] 💬 {entry.kind} {entry.id!r} ({hit.score:.2f}, margin {hit.margin:.2f}, as {hit.variant!r})")
        if entry.kind == "faq":
            self._prefetch_portfolio(entry.topic)  # the portfolio lookup runs while the answer plays
        await self._speak_canned(text)
        if entry.kind == "faq":
            await self._remember_faq(entry)
        return text

    async def _speak_canned(self, text: str):
        """Pre-rendered audio if it exists for exactly this text; otherwise the normal speech route."""
        spoken = say_names(speakable(text))
        pcm = self._audio_cache.load(spoken) if self._audio_cache is not None else None
        if pcm is None or self.audio_in_queue is None:
            await self._say(text)
            return
        import time

        if is_stale(self):
            return
        if self._first_say is None:
            self._first_say = time.monotonic()
        self._on_model_activity()
        self._open_audio_gate()
        for chunk in self._audio_cache.chunks(pcm):
            self.audio_in_queue.put_nowait(chunk)
        print("[Voice Agent] 🔊 Playing pre-rendered audio.")

    async def _remember_faq(self, entry: canned.Entry):
        """The sections an FAQ answer came from count as used, so "tell me more" goes on to new ones; a company answer counts for the
        portfolio offer and for the "overview already said" flag."""
        wanted = {src.split(":", 1)[-1].strip().lower() for src in entry.sources}
        try:
            secs = await asyncio.get_running_loop().run_in_executor(None, retriever.sections)
        except Exception:
            secs = []
        ids = {s["chunk_id"] for s in secs if s["label"].split(": ", 1)[-1].strip().lower() in wanted}
        self._kb_used = self._kb_used | ids | {f"faq:{entry.id}"}  # (the marker keeps "tell me more" working if no section name matched)
        self._kb_last_topic = entry.topic
        if entry.topic == "company":
            self._kb_company_said = True
            self._company_answers += 1
