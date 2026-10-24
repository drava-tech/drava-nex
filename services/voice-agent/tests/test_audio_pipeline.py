"""Audio layer: capture format/metrics, device choice, and recovery from Bluetooth drops.

Levels, noise and distance are synthetic (the instrument is what's tested here: does
the meter read a quiet room / fan / far talker / crosstalk / echo correctly). What a
real room and the real Smiledrive do is measured by `python -m bench.audio_probe`.
"""

import asyncio
import io
import sys
import threading
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from audio import devices  # noqa: E402
from audio.metrics import CaptureMeter, dbfs, echo_tail_seconds, measure_chunk  # noqa: E402
from agent.mic_listener import MicListenerMixin  # noqa: E402
from agent.playback import CHIME, PlaybackMixin, chime_pcm  # noqa: E402

RATE = 16000
CHUNK = 1024
RNG = np.random.default_rng(7)


def pcm(x) -> bytes:
    return (np.clip(np.asarray(x), -1, 1) * 32767).astype(np.int16).tobytes()


def noise(level_dbfs: float, n=CHUNK):
    return RNG.standard_normal(n) * 10 ** (level_dbfs / 20)


def voice(level_dbfs: float, n=CHUNK, f0=140.0, phase=0.0):
    """Harmonic stand-in for a voiced vowel at the given RMS level."""
    t = np.arange(n) / RATE + phase
    x = sum(np.sin(2 * np.pi * f0 * k * t) / k for k in range(1, 12))
    return x / np.sqrt(np.mean(x**2)) * 10 ** (level_dbfs / 20)


def feed(meter, chunks, t0=0.0):
    for i, c in enumerate(chunks):
        meter.feed(pcm(c), None, t0 + i * CHUNK / RATE)


class CaptureFormatTests(unittest.TestCase):
    def test_target_format_constants(self):
        from settings import CHANNELS, CHUNK_SIZE, SEND_SAMPLE_RATE

        self.assertEqual((SEND_SAMPLE_RATE, CHANNELS, CHUNK_SIZE), (16000, 1, 1024))

    def test_vad_frames_are_whole_30ms_pcm16(self):
        # Endpointer slices 16 kHz mono int16 into 30 ms (960-byte) frames; chunk sizes
        # that aren't a multiple must carry the remainder, not drop or duplicate samples.
        from speech.vad import Endpointer

        seen = []
        vad = SimpleNamespace(is_speech=lambda frame, rate: seen.append((len(frame), rate)) or False)
        ep = Endpointer(vad=vad)
        for _ in range(10):
            ep.feed(pcm(noise(-40)))
        self.assertTrue(all(sz == 960 and r == 16000 for sz, r in seen))
        self.assertEqual(len(seen), 10 * CHUNK * 2 // 960)


class QuietRoomAndNoiseTests(unittest.TestCase):
    def test_quiet_room_with_speech(self):
        m = CaptureMeter()
        chunks = [noise(-60)] * 40 + [voice(-24) + noise(-60)] * 20 + [noise(-60)] * 40
        feed(m, chunks)
        self.assertAlmostEqual(dbfs(m.noise_floor()), -60, delta=1.5)
        self.assertGreater(dbfs(m.peak), -24)
        self.assertEqual(m.problems(), [])

    def test_ac_fan_noise_sets_a_higher_floor_not_a_false_problem(self):
        m = CaptureMeter()
        fan = [noise(-42) + 0.004 * np.sin(2 * np.pi * 100 * np.arange(CHUNK) / RATE) for _ in range(80)]
        feed(m, fan)
        self.assertAlmostEqual(dbfs(m.noise_floor()), -42, delta=2.0)
        self.assertEqual(m.clipped_chunks, 0)
        self.assertFalse(m.dead_input(now=80 * CHUNK / RATE))

    def test_noise_floor_ignores_the_speech_in_the_window(self):
        m = CaptureMeter()
        feed(m, [noise(-55)] * 30 + [voice(-20)] * 100)  # 77% of the window is speech
        self.assertLess(dbfs(m.noise_floor()), -50)

    def test_distance_1_2_3_m_is_about_6_db_per_doubling(self):
        # Free-field: -6 dB per doubling of distance from a talker at -18 dBFS @ 0.5 m.
        floor = noise(-58)
        levels = {}
        for metres in (1, 2, 3):
            lvl = -18 - 20 * np.log10(metres / 0.5)
            lvl_chunk = measure_chunk(pcm(voice(lvl) + floor))
            levels[metres] = dbfs(lvl_chunk.rms)
        self.assertAlmostEqual(levels[1] - levels[2], 6.0, delta=1.0)
        self.assertAlmostEqual(levels[1] - levels[3], 9.5, delta=1.5)
        # 3 m is still well clear of the floor (SNR is what the VAD/STT can use).
        self.assertGreater(levels[3] - dbfs(measure_chunk(pcm(floor)).rms), 15)

    def test_multiple_people_talking_louder_than_one_but_not_clipping(self):
        one = measure_chunk(pcm(voice(-24, f0=120)))
        three = measure_chunk(pcm(voice(-24, f0=120) + voice(-24, f0=190, phase=0.01) + voice(-24, f0=240, phase=0.02)))
        self.assertGreater(three.rms, one.rms)
        self.assertEqual(three.clipped, 0)

    def test_clipping_is_counted(self):
        m = CaptureMeter()
        hot = np.clip(voice(-3) * 3, -1, 1)
        feed(m, [hot, noise(-50), hot])
        self.assertEqual(m.clipped_chunks, 2)
        self.assertTrue(any("clipping" in p for p in m.problems()))

    def test_overflow_status_is_reported(self):
        m = CaptureMeter()
        m.feed(pcm(noise(-40)), SimpleNamespace(input_overflow=True), 0.0)
        m.feed(pcm(noise(-40)), None, 0.064)
        self.assertEqual(m.overflows, 1)
        self.assertTrue(any("overflow" in p for p in m.problems()))

    def test_digital_silence_is_a_dead_input_but_a_quiet_room_is_not(self):
        dead = CaptureMeter()
        feed(dead, [np.zeros(CHUNK)] * 60)
        self.assertTrue(dead.dead_input(now=60 * CHUNK / RATE))
        quiet = CaptureMeter()
        feed(quiet, [noise(-70)] * 60)
        self.assertFalse(quiet.dead_input(now=60 * CHUNK / RATE))


class EchoTests(unittest.TestCase):
    """TRAVIS speaking at low / medium / high volume: how long the mic keeps hearing it."""

    def _after(self, start_db, decay_s, floor_db=-50):
        # Echo dies away exponentially into the noise floor, one chunk per 64 ms.
        pts = []
        for i in range(30):
            t = (i + 1) * CHUNK / RATE
            level = floor_db + (start_db - floor_db) * np.exp(-t / decay_s)  # dB above the floor decays
            pts.append((t, 10 ** (level / 20)))
        return pts

    def test_tail_is_short_at_every_volume_and_inside_the_agents_hold_off(self):
        # The agent keeps the mic closed for >= 0.2 s idle + 0.4 s after the last write.
        agent_hold_off = 0.2 + 0.4
        floor = 10 ** (-50 / 20)
        for name, start in (("low", -45.0), ("medium", -30.0), ("high", -20.0)):
            after = [(t, r) for t, r in self._after(start, decay_s=0.25)]
            tail = echo_tail_seconds(after, 0.0, floor)
            self.assertIsNotNone(tail, name)
            self.assertLess(tail, agent_hold_off, name)

    def test_unsettled_echo_is_reported_as_none(self):
        floor = 10 ** (-50 / 20)
        self.assertIsNone(echo_tail_seconds([(i * 0.064, 0.05) for i in range(20)], 0.0, floor))


# ── device choice ────────────────────────────────────────────────────────────

def fake_sd(devs, apis=("MME", "Windows DirectSound", "Windows WASAPI", "Windows WDM-KS")):
    return SimpleNamespace(
        query_devices=lambda *a, **k: devs,
        query_hostapis=lambda i: {"name": apis[i]},
    )


def dev(name, api, ins, outs, rate):
    return {"name": name, "hostapi": api, "max_input_channels": ins, "max_output_channels": outs, "default_samplerate": rate}


SMILE = [
    dev("Headset (Smiledrive)", 0, 1, 0, 44100.0),
    dev("Headset (Smiledrive)", 1, 1, 0, 44100.0),
    dev("Headset (Smiledrive)", 2, 1, 0, 16000.0),
    dev("Headphones (Smiledrive)", 0, 0, 8, 44100.0),
    dev("Headphones (Realtek(R) Audio)", 0, 0, 2, 44100.0),
]


class DeviceChoiceTests(unittest.TestCase):
    def test_input_picks_the_native_16k_wasapi_entry(self):
        with mock.patch.object(devices, "sd", fake_sd(SMILE)), redirect_stdout(io.StringIO()):
            self.assertEqual(devices.resolve_input_device("headset (smiledrive)", strict=True), 2)

    def test_missing_named_mic_raises_when_strict_and_never_falls_back_to_default(self):
        with mock.patch.object(devices, "sd", fake_sd([d for d in SMILE if "Smile" not in d["name"]])):
            with self.assertRaises(devices.AudioDeviceMissing):
                devices.resolve_input_device("Headset (Smiledrive)", strict=True)

    def test_missing_named_mic_non_strict_keeps_the_old_default_fallback(self):
        with mock.patch.object(devices, "sd", fake_sd([])), redirect_stdout(io.StringIO()):
            self.assertIsNone(devices.resolve_input_device("Headset (Smiledrive)"))

    def test_missing_named_speaker_raises_when_strict(self):
        with mock.patch.object(devices, "sd", fake_sd([d for d in SMILE if "Smile" not in d["name"]])):
            with self.assertRaises(devices.AudioDeviceMissing):
                devices.resolve_output_device("Headphones (Smiledrive)", strict=True)

    def test_same_rate_entries_prefer_wasapi_over_mme(self):
        two = [dev("Mic X", 0, 1, 0, 16000.0), dev("Mic X", 2, 1, 0, 16000.0)]
        with mock.patch.object(devices, "sd", fake_sd(two)), redirect_stdout(io.StringIO()):
            self.assertEqual(devices.resolve_input_device("mic x"), 1)

    def test_speaker_without_exact_rate_keeps_first_match_not_wasapi(self):
        # Regression: WASAPI (48 kHz here) rejects the 24 kHz TTS stream (-9997); MME resamples.
        outs = [dev("Headphones (Smiledrive)", 0, 0, 8, 44100.0), dev("Headphones (Smiledrive)", 2, 0, 2, 48000.0)]
        with mock.patch.object(devices, "sd", fake_sd(outs)), redirect_stdout(io.StringIO()):
            self.assertEqual(devices.resolve_output_device("headphones (smiledrive)", strict=True), 0)

    def test_no_hint_is_never_strict(self):
        with mock.patch.object(devices, "sd", fake_sd([])):
            self.assertIsNone(devices.resolve_input_device("", strict=True))

    def test_speaker_may_be_the_same_physical_device_as_the_mic(self):
        # A speakerphone echo-cancels in its own DSP, so the reply must play through it:
        # the speaker is picked by name alone, even though it is the mic's device.
        with mock.patch.object(devices, "sd", fake_sd(SMILE)), redirect_stdout(io.StringIO()):
            mic = devices.resolve_input_device("Headset (Smiledrive)", strict=True)
            speaker = devices.resolve_output_device("Headphones (Smiledrive)", strict=True)
            self.assertEqual(devices.resolve_output_device("smiledrive", strict=True), speaker)
        self.assertEqual((mic, speaker), (2, 3))
        self.assertIn("Smiledrive", SMILE[mic]["name"])
        self.assertIn("Smiledrive", SMILE[speaker]["name"])

    def test_without_a_name_the_os_default_speaker_is_kept_not_moved_away_from_the_mic(self):
        # The old "avoid the mic's device" rule would have switched to another output here.
        with mock.patch.object(devices, "sd", fake_sd(SMILE)):
            self.assertIsNone(devices.resolve_output_device(""))
        with self.assertRaises(TypeError):
            devices.resolve_output_device("", avoid_hint="Smiledrive")  # the rule is gone

    def test_output_resolver_prefers_the_configured_tts_rate(self):
        outs = [dev("Speaker X", 0, 0, 2, 44100.0), dev("Speaker X", 2, 0, 2, 16000.0)]
        with mock.patch.object(devices, "sd", fake_sd(outs)), redirect_stdout(io.StringIO()):
            with mock.patch.object(devices, "RECEIVE_SAMPLE_RATE", 16000):
                self.assertEqual(devices.resolve_output_device("speaker x"), 1)
            with mock.patch.object(devices, "RECEIVE_SAMPLE_RATE", 44100):
                self.assertEqual(devices.resolve_output_device("speaker x"), 0)


# ── recovery ─────────────────────────────────────────────────────────────────

_real_sleep = asyncio.sleep


async def _fast_sleep(delay, *a, **k):
    await _real_sleep(delay / 100)


class FakeStream:
    """An InputStream that feeds the callback from a thread, with scripted behaviour."""

    log: list = []

    def __init__(self, script, device=None, callback=None, **kw):
        self.script, self.device, self.callback = script, device, callback
        self.samplerate, self.channels, self.dtype = kw.get("samplerate", 16000), kw.get("channels", 1), "int16"
        self._stop = threading.Event()
        FakeStream.log.append(script)

    def __enter__(self):
        def run():
            n = 0
            while not self._stop.is_set():
                kind = self.script
                if kind == "stall" and n >= 5:
                    time.sleep(0.01)
                    continue
                if kind == "never":
                    time.sleep(0.01)
                    continue
                data = np.zeros((CHUNK, 1), dtype=np.int16) if kind == "silent" else (noise(-40)[:, None] * 32767).astype(np.int16)
                self.callback(data, CHUNK, None, None)
                n += 1
                time.sleep(0.005)

        self._t = threading.Thread(target=run, daemon=True)
        self._t.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._t.join(1)


class Harness(MicListenerMixin, PlaybackMixin):
    def __init__(self):
        self._capture_meter = CaptureMeter()
        self._audio_events = {}
        self._audio_reset_wanted = False
        self._reinit_requested = False
        self._reinit_done = asyncio.Event()
        self._speaking_lock = threading.Lock()
        self._is_speaking = False
        self._timing = {}
        self.elevenlabs = None
        self.audio_in_queue = asyncio.Queue()
        self._loop = None
        self.states = []
        self.ui = SimpleNamespace(muted=False, set_state=self.states.append)
        self.reinits = 0

    def _clear_preroll(self):
        pass

    async def _reinit_audio(self):  # the real one is exercised in PlaybackTests
        self.reinits += 1

    def callback(self, data, frames, ti, status):
        self._capture_meter.feed(data.tobytes(), status)


CFG = {"mic_device_name": "Headset (Smiledrive)", "mic_stall_sec": 0.3, "mic_dead_sec": 0.6, "mic_first_audio_sec": 0.3}


def run_supervisor(h, resolver, scripts, seconds=1.5, sleep=_fast_sleep):
    """Run _supervise_mic for `seconds`, opening streams per `scripts` (last one repeats)."""
    FakeStream.log = []
    scripts = list(scripts)

    def make_stream(**kw):
        script = scripts.pop(0) if len(scripts) > 1 else scripts[0]
        return FakeStream(script, **kw)

    async def go():
        task = asyncio.create_task(h._supervise_mic(h.callback, CFG))
        await _real_sleep(seconds)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    fake = SimpleNamespace(InputStream=make_stream, query_devices=lambda *a, **k: {"name": "Headset (Smiledrive)"})
    out = io.StringIO()
    with mock.patch("agent.mic_listener.sd", fake), mock.patch("agent.mic_listener.resolve_input_device", resolver), \
            mock.patch("asyncio.sleep", sleep), redirect_stdout(out):
        asyncio.run(go())
    return out.getvalue()


class MicRecoveryTests(unittest.TestCase):
    def test_stalled_stream_is_reopened(self):
        h = Harness()
        run_supervisor(h, lambda hint, strict=False: 17, ["stall", "good"], seconds=1.5)
        self.assertGreaterEqual(len(FakeStream.log), 2)
        self.assertEqual(FakeStream.log[:2], ["stall", "good"])
        self.assertGreaterEqual(h._audio_events.get("mic_reopen", 0), 1)

    def test_mic_that_never_delivers_is_reopened(self):
        h = Harness()
        run_supervisor(h, lambda hint, strict=False: 17, ["never", "good"], seconds=1.2)
        self.assertEqual(FakeStream.log[:2], ["never", "good"])

    def test_bluetooth_mic_missing_then_back_waits_and_resets_audio_never_uses_default(self):
        h = Harness()
        attempts = []

        def resolver(hint, strict=False):
            attempts.append(strict)
            if len(attempts) <= 4:
                raise devices.AudioDeviceMissing("no input device matching 'Headset (Smiledrive)'")
            return 17

        out = run_supervisor(h, resolver, ["good"], seconds=1.5)
        self.assertTrue(all(attempts), "must resolve strictly so the laptop mic is never chosen")
        self.assertGreaterEqual(h.reinits, 1)
        self.assertEqual(FakeStream.log, ["good"])
        self.assertIn("Mic not connected", out)
        self.assertIn("Mic stream open", out)

    def test_open_failures_do_not_end_the_supervisor(self):
        h = Harness()
        calls = {"n": 0}

        def resolver(hint, strict=False):
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("PaErrorCode -9999")
            return 17

        run_supervisor(h, resolver, ["good"], seconds=1.0)
        self.assertEqual(FakeStream.log, ["good"])

    def test_dead_input_is_warned_then_reopened(self):
        h = Harness()
        out = run_supervisor(h, lambda hint, strict=False: 17, ["silent", "good"], seconds=2.0)
        self.assertIn("digital silence", out)
        self.assertEqual(FakeStream.log[:2], ["silent", "good"])

    def test_speaker_asking_for_reset_closes_the_mic_and_reinitialises(self):
        h = Harness()
        h._audio_reset_wanted = True
        run_supervisor(h, lambda hint, strict=False: 17, ["good"], seconds=1.0)
        self.assertGreaterEqual(h.reinits, 1)
        self.assertFalse(h._audio_reset_wanted)
        self.assertGreaterEqual(len(FakeStream.log), 2)  # closed and reopened

    def test_wrong_format_is_called_out(self):
        h = Harness()
        FakeStream.log = []

        def make_stream(**kw):
            kw["samplerate"] = 44100
            return FakeStream("good", **kw)

        async def go():
            task = asyncio.create_task(h._supervise_mic(h.callback, CFG))
            await _real_sleep(0.3)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        fake = SimpleNamespace(InputStream=make_stream, query_devices=lambda *a, **k: {"name": "X"})
        out = io.StringIO()
        with mock.patch("agent.mic_listener.sd", fake), mock.patch("agent.mic_listener.resolve_input_device", lambda h_, strict=False: 1), \
                mock.patch("asyncio.sleep", _fast_sleep), redirect_stdout(out):
            asyncio.run(go())
        self.assertIn("NOT 16 kHz mono int16", out.getvalue())


def _clock(step):
    t = {"v": 0.0}

    def now():
        t["v"] += step * 0.01
        return t["v"]

    return now


class FakeOut:
    def __init__(self, fail_writes=False):
        self.fail_writes = fail_writes
        self.written = []
        self.active = True
        self.closed = False

    def write(self, b):
        if self.fail_writes:
            raise OSError("device gone")
        self.written.append(b)

    def stop(self):
        pass

    def abort(self):
        pass

    def close(self):
        self.closed = True


class PlaybackRecoveryTests(unittest.TestCase):
    def _run(self, h, opener, seconds, feed=None, reinit=None):
        h._SPEAKER_RETRY_S = 0.01
        cfg = {"audio_output_enabled": True, "speaker_gain": 1.0}

        async def go():
            task = asyncio.create_task(h._play_audio())
            if feed:
                await feed(h)
            await _real_sleep(seconds)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        out = io.StringIO()
        with mock.patch("agent.playback.load_api_config", lambda: cfg), \
                mock.patch.object(h, "_open_output_stream", opener), \
                mock.patch("agent.playback.reinit_portaudio", reinit or (lambda: None)), redirect_stdout(out):
            asyncio.run(go())
        return out.getvalue()

    def test_speaker_missing_at_start_then_back_plays_replies(self):
        h = Harness()
        opened = {"n": 0}
        stream = FakeOut()

        def opener(cfg):
            opened["n"] += 1
            if opened["n"] < 3:
                raise devices.AudioDeviceMissing("no output device matching 'Headphones (Smiledrive)'")
            return stream

        async def feed(h):
            await _real_sleep(0.7)  # the playback loop polls every 0.2 s: opens at 0, 0.2, 0.4
            h.audio_in_queue.put_nowait(b"\x01\x00" * 100)

        out = self._run(h, opener, 1.0, feed)
        self.assertEqual(len(stream.written), 1)
        self.assertIn("Speaker unavailable", out)
        self.assertIn("Speaker is back", out)

    def test_after_a_barge_in_reply_audio_is_discarded_but_chimes_play(self):
        h = Harness()
        h._drop_tts_audio = True
        h._stale_chunks_dropped = 0
        stream = FakeOut()
        speaking = []
        real_set_speaking = h.set_speaking
        h.set_speaking = lambda v: (speaking.append(v), real_set_speaking(v))

        async def feed(h):
            h.audio_in_queue.put_nowait(b"\x01\x00" * 100)
            h.audio_in_queue.put_nowait(CHIME)
            h.audio_in_queue.put_nowait(b"\x02\x00" * 100)

        self._run(h, lambda cfg: stream, 0.5, feed)
        self.assertEqual(h._stale_chunks_dropped, 2)
        self.assertEqual(len(stream.written), 1)  # only the chime reached the speaker
        self.assertNotIn(True, speaking)  # the dropped chunks never marked Travis as speaking

    def test_open_audio_gate_stops_discarding_and_resets_the_counter(self):
        from agent.local import TravisLocal

        a = SimpleNamespace(_drop_tts_audio=True, _stale_chunks_dropped=3)
        with redirect_stdout(io.StringIO()):
            TravisLocal._open_audio_gate(a)
        self.assertFalse(a._drop_tts_audio)
        self.assertEqual(a._stale_chunks_dropped, 0)

    def test_reply_while_speaker_is_down_is_dropped_with_a_note_not_a_hang(self):
        h = Harness()

        async def feed(h):
            h.audio_in_queue.put_nowait(b"\x01\x00" * 100)

        def opener(cfg):
            raise OSError("not connected")

        out = self._run(h, opener, 0.3, feed)
        self.assertIn("reply was dropped", out)
        self.assertFalse(h._is_speaking)

    def test_write_failure_closes_the_stream_and_a_new_one_is_opened(self):
        h = Harness()
        streams = [FakeOut(fail_writes=True), FakeOut()]

        def opener(cfg):
            return streams.pop(0)

        async def feed(h):
            await _real_sleep(0.1)
            h.audio_in_queue.put_nowait(b"\x01\x00" * 100)
            await _real_sleep(0.5)
            h.audio_in_queue.put_nowait(b"\x01\x00" * 100)

        first = streams[0]
        second = streams[1]
        out = self._run(h, opener, 1.0, feed)
        self.assertTrue(first.closed)
        self.assertEqual(len(second.written), 1)
        self.assertIn("Playback write failed", out)
        self.assertEqual(h._audio_events["speaker_write_failed"], 1)

    def test_three_failed_opens_ask_the_mic_supervisor_for_an_audio_reset(self):
        h = Harness()

        def opener(cfg):
            raise OSError("nope")

        self._run(h, opener, 0.5)
        self.assertTrue(h._audio_reset_wanted)

    def test_reinit_handshake_closes_speaker_reinitialises_and_reopens(self):
        h = Harness()
        stream1, stream2 = FakeOut(), FakeOut()
        streams = [stream1, stream2]
        calls = []

        async def feed(h):
            await _real_sleep(0.1)
            await h._reinit_audio.__func__(h)  # the real handshake (Harness overrides it for mic tests)

        # Harness stubs _reinit_audio; use the real PlaybackMixin implementation here.
        h._reinit_audio = PlaybackMixin._reinit_audio.__get__(h)

        async def feed2(h):
            await _real_sleep(0.1)
            await h._reinit_audio()
            calls.append("done")

        self._run(h, lambda cfg: streams.pop(0), 0.6, feed2, reinit=lambda: calls.append("reinit"))
        self.assertEqual(calls, ["reinit", "done"])
        self.assertTrue(stream1.closed)
        self.assertEqual(streams, [])  # the second stream was opened after the re-init

    def test_reinit_does_not_hang_if_playback_is_not_running(self):
        h = Harness()
        h._reinit_audio = PlaybackMixin._reinit_audio.__get__(h)

        async def go():
            real_wait_for = asyncio.wait_for
            with mock.patch("agent.playback.asyncio.wait_for", lambda aw, timeout: real_wait_for(aw, 0.05)):
                await h._reinit_audio()

        with redirect_stdout(io.StringIO()) as out:
            asyncio.run(go())
        self.assertFalse(h._reinit_requested)
        self.assertIn("skipping the audio re-init", out.getvalue())


class LongRunTests(unittest.TestCase):
    def test_two_hours_of_chunks_keeps_memory_bounded_and_the_floor_stable(self):
        m = CaptureMeter()
        n = int(2 * 3600 * RATE / CHUNK)  # 112,500 chunks
        base = pcm(noise(-50))
        for i in range(n):
            m.feed(base, None, i * CHUNK / RATE)
        self.assertEqual(m.chunks, n)
        self.assertLessEqual(len(m._rms), 160)
        self.assertAlmostEqual(dbfs(m.noise_floor()), -50, delta=1.5)
        self.assertEqual(m.problems(), [])


# ── tts_sample_rate, wake chime on the main stream, mic back-off cap ─────────

class TtsSampleRateTests(unittest.TestCase):
    def _rate(self, value):
        import settings
        cfg = {} if value is None else {"tts_sample_rate": value}
        with mock.patch.object(settings, "load_api_config", lambda: cfg):
            return settings._tts_sample_rate()

    def test_default_is_24000_and_the_key_overrides_it(self):
        self.assertEqual(self._rate(None), 24000)
        self.assertEqual(self._rate(16000), 16000)
        self.assertEqual(self._rate("22050"), 22050)

    def test_unsupported_or_garbage_values_fall_back_to_the_default(self):
        for bad in (12345, 0, -1, "abc", [16000]):
            self.assertEqual(self._rate(bad), 24000, bad)

    def test_the_setting_reaches_elevenlabs_the_speaker_stream_and_the_chime(self):
        import speech.elevenlabs_stream as el

        class FakeWS:
            state = el.State.OPEN

            def __init__(self):
                self.sent = []

            async def send(self, m):
                self.sent.append(m)

            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

            async def close(self):
                pass

        seen = {}

        async def fake_connect(uri):
            seen["uri"] = uri
            return FakeWS()

        async def go():
            with mock.patch.object(el, "RECEIVE_SAMPLE_RATE", 16000), \
                    mock.patch.object(el.websockets, "connect", fake_connect):
                s = el.ElevenLabsStreamer("key", "voice", audio_queue=asyncio.Queue())
                self.assertEqual(s.sample_rate, 16000)
                await s.prewarm()
                await s.cancel()

        asyncio.run(go())
        self.assertIn("output_format=pcm_16000", seen["uri"])

        opened = {}

        class FakeRaw:
            def __init__(self, **kw):
                opened.update(kw)

            def start(self):
                pass

        h = Harness()
        with mock.patch("agent.playback.RECEIVE_SAMPLE_RATE", 16000), \
                mock.patch("agent.playback.sd", SimpleNamespace(RawOutputStream=FakeRaw)), \
                mock.patch("agent.playback.resolve_output_device", lambda *a, **k: 3):
            h._open_output_stream({"speaker_device_name": "Headphones (Smiledrive)"})
        self.assertEqual(opened["samplerate"], 16000)
        self.assertEqual(len(chime_pcm(16000)), 2 * int(16000 * 0.09) * 2)  # two notes, int16
        self.assertNotEqual(chime_pcm(16000), chime_pcm(24000))


class WakeChimeTests(unittest.TestCase):
    """The chime goes through the playback loop and its output stream, not a separate sd.play."""

    def _chime_run(self, stream, cfg_extra=None, speaker_down=False):
        h = Harness()
        cfg = {"audio_output_enabled": True, "speaker_gain": 1.0, **(cfg_extra or {})}

        def opener(c):
            if speaker_down:
                raise OSError("not connected")
            return stream

        h._SPEAKER_RETRY_S = 0.01
        out = io.StringIO()

        async def go():
            task = asyncio.create_task(h._play_audio())
            h._loop = asyncio.get_running_loop()
            await asyncio.to_thread(h._play_chime)  # the mic callback runs off the event loop
            await _real_sleep(0.4)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        def no_sd_play(*a, **k):
            raise AssertionError("the chime must not open its own sd.play stream")

        with mock.patch("agent.playback.load_api_config", lambda: cfg), \
                mock.patch.object(h, "_open_output_stream", opener), \
                mock.patch("agent.playback.sd", SimpleNamespace(play=no_sd_play)), redirect_stdout(out):
            asyncio.run(go())
        return h, out.getvalue()

    def test_chime_is_written_to_the_main_output_stream(self):
        stream = FakeOut()
        self._chime_run(stream)
        import settings
        self.assertEqual(stream.written, [chime_pcm(settings.RECEIVE_SAMPLE_RATE)])

    def test_chime_does_not_mark_travis_as_speaking_or_touch_reply_timing(self):
        stream = FakeOut()
        h, _ = self._chime_run(stream)
        self.assertNotIn("SPEAKING", h.states)
        self.assertFalse(h._is_speaking)
        self.assertNotIn("first_audio_chunk_received", h._timing)

    def test_chime_gets_the_same_speaker_gain_as_replies(self):
        stream = FakeOut()
        self._chime_run(stream, {"speaker_gain": 0.5})
        import settings
        from audio.devices import apply_gain
        self.assertEqual(stream.written, [apply_gain(chime_pcm(settings.RECEIVE_SAMPLE_RATE), 0.5)])

    def test_chime_is_skipped_when_disabled_or_output_is_off(self):
        for extra in ({"wake_chime": False}, {"audio_output_enabled": False}):
            stream = FakeOut()
            self._chime_run(stream, extra)
            self.assertEqual(stream.written, [], extra)

    def test_chime_with_the_speaker_down_is_dropped_quietly(self):
        h, out = self._chime_run(FakeOut(), speaker_down=True)
        self.assertNotIn("reply was dropped", out)

    def test_chime_marker_is_a_distinct_queue_item(self):
        self.assertIsNot(CHIME, b"")
        self.assertEqual(repr(CHIME), "<wake chime>")


class MicBackoffCapTests(unittest.TestCase):
    def _delays(self, resolver, seconds=1.5):
        delays = []

        async def rec(delay, *a, **k):
            delays.append(delay)
            await _real_sleep(delay / 100)

        run_supervisor(Harness(), resolver, ["good"], seconds=seconds, sleep=rec)
        return delays

    def test_generic_errors_back_off_1_2_4_then_stay_at_5_seconds(self):
        def resolver(hint, strict=False):
            raise RuntimeError("PaErrorCode -9999")

        delays = self._delays(resolver)
        self.assertGreaterEqual(len(delays), 6)
        self.assertEqual(delays[:4], [1.0, 2.0, 4.0, 5.0])
        self.assertLessEqual(max(delays), 5.0)

    def test_missing_device_is_capped_at_5_seconds_too(self):
        def resolver(hint, strict=False):
            raise devices.AudioDeviceMissing("no input device matching 'Headset (Smiledrive)'")

        delays = self._delays(resolver)
        self.assertGreaterEqual(len(delays), 6)
        self.assertLessEqual(max(delays), 5.0)

    def test_reinit_condition_is_explicit_about_precedence(self):
        # 3 failures of any kind, or every 5th failure while the device is missing.
        src = (AGENT_ROOT / "agent" / "mic_listener.py").read_text(encoding="utf-8")
        self.assertIn("if failures >= 3 or (missing and failures % 5 == 0):", src)


if __name__ == "__main__":
    unittest.main()
