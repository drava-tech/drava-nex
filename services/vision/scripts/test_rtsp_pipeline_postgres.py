"""
test_rtsp_pipeline_postgres.py — full pipeline dry run against the real
shared cms_db Postgres+pgvector instance (db_face_recognition.py).

This now targets DATABASE_URL — the real, shared production database the
rest of cms-platform uses (packages/db/src/schema/visitors.ts owns `visitor`;
we only added the new, additive `visitor_embedding` table via
visitor_embedding_migration.sql, applied directly to this DB). Writes here
are real and visible to the actual CMS Visitors page.

Run it twice in a row: the first run should enroll new visitors, the second
run should recognize the same people instead of re-enrolling them.

Usage (from services/vision/, venv active). Reads DATABASE_URL plus the
camera vars from services/vision/.env:
    python scripts/test_rtsp_pipeline_postgres.py
"""

from __future__ import annotations
import logging
import os
import sys
import time

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.angle_sampling import (  # noqa: E402
    MAJORITY_VOTE_THRESHOLD, MAX_PENDING_RAW_SAMPLES, MIN_PITCH_BUCKETS_TO_REGISTER, MIN_SAMPLES_FOR_VOTE,
    MIN_SAMPLES_TO_REGISTER, MIN_YAW_BUCKETS_TO_REGISTER,
    FrameSample, angle_bucket, close_photo_preview, collect_diverse_samples, face_for_track,
    filter_good_quality, maybe_capture_more, make_config, person_folder_name, pitch_bucket,
    register_new_person, rename_person_folder, seed_samples, show_photo_preview_bytes, vote_identity, yaw_bucket,
)
from vision.camera_rtsp import RtspCamera, rtsp_url_from_env  # noqa: E402
from vision.db_face_recognition import FaceRecognitionDb  # noqa: E402
from vision.engines.face import FaceEngine  # noqa: E402
from vision.tracker import IouTracker, TrackState  # noqa: E402

log = logging.getLogger("test_rtsp_pipeline_postgres")

RUN_SECONDS = 15.0


def _label(name: str, visitor_uuid: str) -> str:
    """Printable stand-in for an unnamed visitor. Never feed this into
    person_folder_name()/seed_samples() — those need the raw name (""
    means "not named yet"), not this placeholder, or the uuid suffix gets
    appended twice (e.g. "Unnamed-f709601d_f709601d" instead of
    "Unnamed_f709601d") since person_folder_name() already adds its own."""
    return name if name else f"Unnamed-{visitor_uuid[:8]}"


def _prompt_for_name(face_db, cfg, visitor_uuid: str, image_filename) -> str:
    """Ask for a name right when a new person is enrolled, and save it
    immediately — unlike the real CMS's Visitors page (staff name anonymous
    entries later, whenever convenient), this is a synchronous, in-the-moment
    prompt for this console pipeline. Shows the enrollment photo in a small
    preview window first (see angle_sampling.show_photo_preview()), so
    you're actually looking at who you're naming rather than just a
    filename. Blocks the camera loop while waiting on input — acceptable
    here since RtspCamera's background thread keeps reading/dropping frames
    on its own, so the connection doesn't stall, just frames during the
    pause aren't processed. Press Enter to skip and leave them anonymous
    (nameable later via assign_names.py or the CMS admin flow).

    Returns the raw name ("" if skipped) — use _label() to get something
    printable, not this return value directly."""
    photo_note = f" (photo: {image_filename})" if image_filename else ""
    # Crop bytes live in the DB now — preview from there, not off disk.
    preview_shown = show_photo_preview_bytes(face_db.get_primary_image(visitor_uuid))
    if not preview_shown:
        log.warning("No stored crop to preview for %s — naming blind.", visitor_uuid[:8])
    name = input(f"New person enrolled [{visitor_uuid[:8]}]{photo_note} — name? (Enter to skip): ").strip()
    if preview_shown:
        close_photo_preview()
    if name:
        face_db.set_name(visitor_uuid, name)
        log.info("Visitor %s named '%s'", visitor_uuid, name)
    return name


def _lookup_name(face_db, visitor_names: dict, visitor_uuid: str) -> str:
    """Raw stored name ("" if not yet named) for this visitor, resolved once
    per visitor per run and cached — a matched track may belong to someone
    named in an earlier run, so the name isn't necessarily in this run's
    cache yet. Use _label() for anything printed to the console."""
    if visitor_uuid in visitor_names:
        return visitor_names[visitor_uuid]
    row = face_db.query_one("SELECT name FROM visitor WHERE uuid = %s", (visitor_uuid,))
    name = row[0] if row and row[0] else ""
    visitor_names[visitor_uuid] = name
    return name


def _print_room_if_changed(tracker, visitor_names: dict, last_room: set) -> set:
    """Print who's currently in frame, by name, only when the set of
    identified people actually changes — someone entering, leaving, or a
    track resolving to a name for the first time. Avoids reprinting the
    same list every single frame at 20-30fps."""
    current = {t.visitor_uuid for t in tracker.tracks
               if t.state is TrackState.IDENTIFIED and t.visitor_uuid is not None}
    if current != last_room:
        names = sorted(_label(visitor_names.get(u, ""), u) for u in current)
        print(f"In frame now: {', '.join(names) if names else '(nobody)'}")
    return current


def _min_side(bbox) -> float:
    x1, y1, x2, y2 = (float(v) for v in bbox[:4])
    return min(x2 - x1, y2 - y1)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_dotenv()

    url = rtsp_url_from_env()
    if not url:
        print("!! Set VISION_RTSP_URL, or VISION_TAPO_USER/PASS/IP, in .env first.")
        sys.exit(1)

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        print("!! Set DATABASE_URL in .env first.")
        sys.exit(1)

    cfg = make_config(
        database_url="unused", api_url="http://localhost:4000", broadcast_secret="unused",
        camera_id="cam-rtsp-test",
        # image_dir is always absolute_image_dir() automatically — see
        # make_config()'s docstring for why this is a factory now instead of
        # calling Config(...) directly.
        # Production default is 0.5. Calibrated against real intra-person vs
        # inter-person embedding distances measured from this camera's
        # actual captured data (see visitor_embedding table): same-person
        # pairs ranged 0.008-0.700, different-person pairs 0.678-1.148 — a
        # real but narrow overlap zone (0.678-0.700), everywhere else
        # cleanly separated. At 0.5, everything in [0.50, 0.70) was being
        # missed as a match — 35 of 79 observed same-person pairs, including
        # the Kushal/98173000 duplicate (0.562) — despite zero observed
        # different-person pairs below 0.678. 0.65 recovers all but 5 of
        # those missed matches with zero false-accepts in the data seen so
        # far. Revisit as more people get enrolled — this is calibrated
        # against a handful of real people (449 inter-person, 79
        # intra-person pairs), not a statistically validated FAR/FRR.
        match_max_distance=0.65,
        # Production default is 80px, but the camera's current placement
        # can't be changed — accepting smaller/lower-quality faces down to
        # 40px so people are at least tracked/matched instead of ignored.
        min_bbox_px=40,
        # track_confirm_frames no longer gates identity decisions (see the
        # PENDING branch below) — that's now driven by MIN_SAMPLES_FOR_VOTE/
        # MIN_SAMPLES_TO_REGISTER in angle_sampling.py instead, since a fixed
        # frame count was a poor proxy for "enough evidence" (a brief
        # sighting could hit the count with only 1 usable sample after
        # quality filtering).
        # See preview_recognition.py for why: once IDENTIFIED, a track's
        # state never reverts on its own — but IouTracker can spawn a
        # brand-new track_id for the same physical person (bbox overlap
        # between frames drops below track_iou_threshold from a quick turn,
        # or a face goes undetected for track_max_misses frames at a steep
        # angle), which starts back in PENDING and re-shows "confirming.../
        # waiting for a clearer angle" for someone already recognized.
        # Lowered iou threshold + raised max misses make that fragmentation
        # less likely.
        track_iou_threshold=0.15,
        track_max_misses=45,
    )

    print("Loading face engine (buffalo_l)...")
    engine = FaceEngine(cfg)
    engine.load()

    face_db = FaceRecognitionDb(database_url, cfg.match_max_distance, cfg.cooldown_seconds)
    face_db.connect()

    tracker = IouTracker(cfg)
    pending_faces: dict[int, list] = {}
    visitor_names: dict[str, str] = {}
    last_room: set = set()
    matches = 0
    enrolls = 0

    camera = RtspCamera(url)
    with camera:
        frame = None
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            frame = camera.read_frame()
            if frame is not None:
                break
            time.sleep(0.1)
        if frame is None:
            print("!! No frame received — check the camera connection/credentials.")
            sys.exit(1)

        print(f"Running for {RUN_SECONDS:.0f}s...")
        start = time.monotonic()
        frames_processed = 0
        while time.monotonic() - start < RUN_SECONDS:
            frame = camera.read_frame()
            if frame is None:
                time.sleep(0.02)
                continue
            frames_processed += 1

            all_faces = engine.detect(frame)
            faces = [f for f in all_faces if _min_side(f.bbox) >= cfg.min_bbox_px]
            seen = tracker.update(faces)

            for track in seen:
                if track.state is TrackState.PENDING:
                    track.confirm_count += 1
                    buf = pending_faces.setdefault(track.track_id, [])
                    # .copy(): this script is headless so nothing draws on
                    # `frame` after capture today, but FrameSample's
                    # contract is "the exact frame it came from" — that
                    # should hold unconditionally, not depend on the caller
                    # never mutating it later (preview_recognition.py did
                    # exactly that and got "confirming" text baked into
                    # saved photos as a result).
                    buf.append(FrameSample(face_for_track(track, faces), frame.copy()))
                    if len(buf) > MAX_PENDING_RAW_SAMPLES:
                        del buf[0]  # safety cap — an inconclusive track shouldn't grow this forever

                    # Only decide off frames good enough to trust (see
                    # is_good_quality) — a face looking down/away can still
                    # be tracked, it just shouldn't count as evidence either
                    # way. Never decide off a single frame either: need at
                    # least MIN_SAMPLES_FOR_VOTE independent good samples
                    # before even attempting a vote, so a lucky/unlucky
                    # single frame can't swing the decision.
                    good = filter_good_quality(buf)
                    if len(good) < MIN_SAMPLES_FOR_VOTE:
                        continue  # not enough evidence yet — stays Unknown, nothing written

                    # Collect from every good frame seen so far, not just
                    # one — a brand new visitor then starts with several
                    # stored angles instead of one, and matching gets
                    # several chances to find an existing record instead of
                    # one. Temporal verification: every sample votes on its
                    # own nearest match; only a clear majority (not a single
                    # frame) is acted on.
                    samples = collect_diverse_samples(good)
                    best_uuid, fraction = vote_identity(face_db, samples)

                    if best_uuid is not None and fraction >= MAJORITY_VOTE_THRESHOLD:
                        pending_faces.pop(track.track_id)
                        face_db.touch(best_uuid)
                        name = _lookup_name(face_db, visitor_names, best_uuid)
                        seed_samples(face_db, cfg, best_uuid, name, samples, skip_first=False)
                        matches += 1
                        log.info("Track %d matched %s (%.0f%% vote agreement, %d sample(s))",
                                  track.track_id, _label(name, best_uuid), fraction * 100, len(samples))
                        track.visitor_uuid = best_uuid
                        track.state = TrackState.IDENTIFIED
                        track.captured_buckets = {angle_bucket(s.face.kps) for s in samples}
                    elif (best_uuid is None and fraction >= MAJORITY_VOTE_THRESHOLD
                          and len(samples) >= MIN_SAMPLES_TO_REGISTER
                          and len({yaw_bucket(s.face.kps) for s in samples}) >= MIN_YAW_BUCKETS_TO_REGISTER
                          and len({pitch_bucket(s.face.kps) for s in samples}) >= MIN_PITCH_BUCKETS_TO_REGISTER):
                        # Do NOT auto-register off a hunch: only once enough
                        # diverse, good samples (5-10) *consistently* fail to
                        # match anyone do we treat this as a genuinely new
                        # person, not "unknown" (this is exactly the
                        # requirement — a single unmatched frame used to
                        # register a brand-new visitor immediately; now it
                        # takes real, repeated evidence). Sample COUNT alone
                        # isn't enough either — someone who barely turns
                        # their head could rack up 5 near-identical-angle
                        # samples; also require real spread across both yaw
                        # (left-right) AND pitch (up-down) — a real failure
                        # found in testing was 10 samples spanning several
                        # yaw buckets that ALL shared the same bad,
                        # close-up downward pitch, since nothing checked
                        # vertical spread before.
                        pending_faces.pop(track.track_id)
                        visitor_uuid = register_new_person(face_db, cfg, samples)
                        enrolls += 1
                        log.info("Track %d registered new visitor %s (%d diverse sample(s), "
                                  "%.0f%% agreed nobody matched)",
                                  track.track_id, visitor_uuid, len(samples), fraction * 100)
                        image_path = os.path.join(person_folder_name(None, visitor_uuid), "01.jpg")
                        name = _prompt_for_name(face_db, cfg, visitor_uuid, image_path)
                        visitor_names[visitor_uuid] = name
                        rename_person_folder(face_db, cfg, visitor_uuid, name, image_path)
                        print(f"{_label(name, visitor_uuid)} registered and now in the room.")
                        track.visitor_uuid = visitor_uuid
                        track.state = TrackState.IDENTIFIED
                        track.captured_buckets = {angle_bucket(s.face.kps) for s in samples}
                    # else: inconclusive so far (votes split, or not enough
                    # samples yet to register) — keep gathering, stays
                    # Unknown, nothing written to the DB.
                elif track.visitor_uuid is not None:
                    face_db.touch(track.visitor_uuid)
                    name = _lookup_name(face_db, visitor_names, track.visitor_uuid)
                    if maybe_capture_more(face_db, track, track.best_face, cfg, frame, name):
                        log.info("Track %d added angle sample for visitor %s (%d total)",
                                  track.track_id, track.visitor_uuid,
                                  face_db.embedding_count(track.visitor_uuid))

            last_room = _print_room_if_changed(tracker, visitor_names, last_room)

        elapsed = time.monotonic() - start
        print(f"Processed {frames_processed} frames in {elapsed:.1f}s "
              f"({frames_processed / elapsed:.1f} fps)")
        print(f"matches={matches} enrolls={enrolls} active_tracks={len(tracker.tracks)}")

    visitor_count = face_db.query_one("SELECT COUNT(*) FROM visitor", ())[0]
    embedding_count = face_db.query_one("SELECT COUNT(*) FROM visitor_embedding", ())[0]
    print(f"{visitor_count} visitor(s), {embedding_count} total embedding sample(s) in Postgres")
    face_db.close()


if __name__ == "__main__":
    main()
