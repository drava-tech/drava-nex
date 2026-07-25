"""
preview_recognition.py — live visual preview: real camera + real GPU detection
+ tracking + matching/enrollment against local Postgres+pgvector, with boxes
color-coded by state so you can see at what face size/distance recognition
actually kicks in.

Box colors:
    red        — detected but below min_bbox_px (too small/far to identify;
                 shown for reference only, never tracked/matched/registered)
    yellow     — Unknown: still gathering evidence, or gathered enough
                 samples but votes were inconclusive either way (see
                 vote_identity() in angle_sampling.py) — nothing is written
                 to the DB in this state, however long it lasts
    cyan       — just registered this frame (genuinely new visitor — only
                 happens once several diverse samples consistently failed
                 to match anyone, never off a single frame)
    green      — matched to an existing visitor (label shows their name +
                 sample count once majority-vote confirmed the match)

The visitor DB persists across runs (it's the real shared cms_db, the same
Postgres apps/api and the CMS Visitors page use), so running this more than
once lets you see previously-enrolled people get recognized instead of
re-enrolled — and enrollments here are real, visible visitor records.

Usage (from services/vision/, venv active). Reads DATABASE_URL plus the
camera vars from services/vision/.env:
    python scripts/preview_recognition.py
Press q to quit.
"""

from __future__ import annotations
import os
import sys
import time

import cv2
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from vision.angle_sampling import (  # noqa: E402
    MAJORITY_VOTE_THRESHOLD, MAX_PENDING_RAW_SAMPLES, MIN_PITCH_BUCKETS_TO_REGISTER, MIN_SAMPLES_FOR_VOTE,
    MIN_SAMPLES_TO_REGISTER, MIN_YAW_BUCKETS_TO_REGISTER,
    FrameSample, angle_bucket, collect_diverse_samples, face_for_track, filter_good_quality,
    maybe_capture_more, make_config, pitch_bucket, register_new_person, seed_samples, vote_identity, yaw_bucket,
)
from vision.camera_rtsp import RtspCamera, rtsp_url_from_env  # noqa: E402
from vision.db_face_recognition import FaceRecognitionDb  # noqa: E402
from vision.engines.face import FaceEngine  # noqa: E402
from vision.tracker import IouTracker, TrackState  # noqa: E402

RED = (0, 0, 255)
YELLOW = (0, 220, 220)
CYAN = (220, 220, 0)
GREEN = (0, 200, 0)


def _min_side(bbox) -> float:
    x1, y1, x2, y2 = (float(v) for v in bbox[:4])
    return min(x2 - x1, y2 - y1)


def _get_name(face_db, visitor_uuid: str):
    """This preview never prompts for a name, but a matched visitor may
    have been named via test_rtsp_pipeline_postgres.py/assign_names.py
    sharing the same DB — look it up so their photos keep landing in the
    right folder."""
    row = face_db.query_one("SELECT name FROM visitor WHERE uuid = %s", (visitor_uuid,))
    return row[0] if row and row[0] else None


def _label_for(name, visitor_uuid: str) -> str:
    """Printable stand-in for the on-screen box label — the real name if
    they've been named (via the other script or assign_names.py), otherwise
    a short-uuid placeholder. Previously this preview always showed the raw
    uuid even for named visitors, since the label was built before name
    lookup was wired in for the folder-saving logic."""
    return name if name else f"Unnamed-{visitor_uuid[:8]}"


def _room_names(tracker, face_db) -> list[str]:
    """Names of everyone currently IDENTIFIED (matched or registered) in
    frame, right now — looked up fresh each call rather than cached, since
    this preview has no persistent visitor_names dict of its own."""
    uuids = {t.visitor_uuid for t in tracker.tracks
             if t.state is TrackState.IDENTIFIED and t.visitor_uuid is not None}
    return sorted(_label_for(_get_name(face_db, u), u) for u in uuids)


def main() -> None:
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
        database_url="unused",
        api_url="http://localhost:4000",
        broadcast_secret="unused",
        camera_id="cam-preview",
        # image_dir is always absolute_image_dir() automatically — see
        # make_config()'s docstring.
        # See test_rtsp_pipeline_postgres.py for the full calibration
        # rationale (real intra-/inter-person distance data from this
        # camera). Production default 0.5 → 0.65.
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
        # Once IDENTIFIED, a track's state never reverts on its own — but if
        # IouTracker's frame-to-frame bbox overlap drops below this (person
        # turning/moving quickly shrinks or shifts the box) or a face isn't
        # detected for track_max_misses frames in a row (steep angle briefly
        # defeats the detector), the tracker spawns a brand-new track_id for
        # the same physical person — which starts back in PENDING, showing
        # "confirming.../waiting for a clearer angle" again even though
        # they'd already been recognized. Lowered iou threshold (easier to
        # keep associating a moving/turning box with its existing track) and
        # raised max misses (tolerate a longer detection gap) so a person
        # who's already been identified is less likely to get fragmented
        # into a new, unidentified track.
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

    camera = RtspCamera(url)
    camera.start()

    prev_time = time.time()
    fps = 0.0
    last_room: list[str] = []

    try:
        while True:
            frame = camera.read_frame()
            if frame is None:
                time.sleep(0.01)
                continue

            all_faces = engine.detect(frame)
            faces = [f for f in all_faces if _min_side(f.bbox) >= cfg.min_bbox_px]
            too_small = [f for f in all_faces if _min_side(f.bbox) < cfg.min_bbox_px]

            for f in too_small:
                x1, y1, x2, y2 = f.bbox.astype(int)
                cv2.rectangle(frame, (x1, y1), (x2, y2), RED, 1)
                cv2.putText(frame, f"{_min_side(f.bbox):.0f}px < {cfg.min_bbox_px}px",
                            (x1, max(y1 - 6, 0)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, RED, 1)

            seen = tracker.update(faces)
            for track in seen:
                x1, y1, x2, y2 = (int(v) for v in track.bbox)

                if track.state is TrackState.PENDING:
                    track.confirm_count += 1
                    buf = pending_faces.setdefault(track.track_id, [])
                    # .copy(): this same `frame` array gets the on-screen
                    # box/label drawn onto it a few lines below (and onto
                    # any other track's crop region too, in a multi-person
                    # frame) — without a snapshot here, a sample captured
                    # while still "confirming" ends up with that overlay
                    # baked into its saved photo once drawing happens
                    # later in this same iteration (real bug: several
                    # saved crops showed "confirm"/"confirming" text).
                    buf.append(FrameSample(face_for_track(track, faces), frame.copy()))
                    if len(buf) > MAX_PENDING_RAW_SAMPLES:
                        del buf[0]  # safety cap — an inconclusive track shouldn't grow this forever

                    # Only decide off frames good enough to trust — a face
                    # looking down/away can still be tracked, it just
                    # shouldn't count as evidence either way. Never decide
                    # off a single frame either: need at least
                    # MIN_SAMPLES_FOR_VOTE independent good samples before
                    # even attempting a vote.
                    good = filter_good_quality(buf)
                    if len(good) < MIN_SAMPLES_FOR_VOTE:
                        track.label = f"Unknown — gathering evidence ({len(good)} sample(s))"
                        track.color = YELLOW
                        cv2.rectangle(frame, (x1, y1), (x2, y2), track.color, 2)
                        cv2.putText(frame, track.label, (x1, max(y1 - 6, 0)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, track.color, 2)
                        continue

                    # Temporal verification: every good sample votes on its
                    # own nearest match; only a clear majority (never a
                    # single frame) is acted on.
                    samples = collect_diverse_samples(good)
                    best_uuid, fraction = vote_identity(face_db, samples)

                    if best_uuid is not None and fraction >= MAJORITY_VOTE_THRESHOLD:
                        pending_faces.pop(track.track_id)
                        track.visitor_uuid = best_uuid
                        face_db.touch(track.visitor_uuid)
                        name = _get_name(face_db, track.visitor_uuid)
                        seed_samples(face_db, cfg, track.visitor_uuid, name, samples, skip_first=False)
                        track.color = GREEN
                        track.state = TrackState.IDENTIFIED
                        track.captured_buckets = {angle_bucket(s.face.kps) for s in samples}
                        sample_count = face_db.embedding_count(track.visitor_uuid)
                        track.label = (f"matched {_label_for(name, track.visitor_uuid)} "
                                       f"({sample_count} sample{'s' if sample_count != 1 else ''})")
                    elif (best_uuid is None and fraction >= MAJORITY_VOTE_THRESHOLD
                          and len(samples) >= MIN_SAMPLES_TO_REGISTER
                          and len({yaw_bucket(s.face.kps) for s in samples}) >= MIN_YAW_BUCKETS_TO_REGISTER
                          and len({pitch_bucket(s.face.kps) for s in samples}) >= MIN_PITCH_BUCKETS_TO_REGISTER):
                        # Do NOT auto-register off a hunch: only once enough
                        # diverse, good samples (5-10) *consistently* fail to
                        # match anyone do we treat this as a genuinely new
                        # person, not "unknown". Count alone isn't enough
                        # either — also require real spread across both yaw
                        # (left-right) AND pitch (up-down): a real failure
                        # found in testing was 10 samples spanning several
                        # yaw buckets that ALL shared the same bad, close-up
                        # downward pitch.
                        pending_faces.pop(track.track_id)
                        track.visitor_uuid = register_new_person(face_db, cfg, samples)
                        # No naming prompt in this preview — goes straight
                        # into an Unnamed_xxxxxxxx folder; assign_names.py
                        # or the CMS frontend handles naming later.
                        track.color = CYAN
                        track.state = TrackState.IDENTIFIED
                        track.captured_buckets = {angle_bucket(s.face.kps) for s in samples}
                        sample_count = face_db.embedding_count(track.visitor_uuid)
                        track.label = (f"registered {_label_for(None, track.visitor_uuid)} "
                                       f"({sample_count} sample{'s' if sample_count != 1 else ''})")
                    else:
                        # Inconclusive so far (votes split, or not enough
                        # samples yet to register) — keep gathering, stays
                        # Unknown, nothing written to the DB.
                        track.label = f"Unknown — undetermined ({len(good)} sample(s))"
                        track.color = YELLOW
                elif track.visitor_uuid is not None:
                    face_db.touch(track.visitor_uuid)
                    # Keep widening this visitor's stored angle coverage for as
                    # long as they're in frame — mitigates the fixed camera
                    # distance/angle by giving future sightings more samples
                    # to potentially match against.
                    name = _get_name(face_db, track.visitor_uuid)
                    if maybe_capture_more(face_db, track, track.best_face, cfg, frame, name):
                        sample_count = face_db.embedding_count(track.visitor_uuid)
                        kind = "matched" if track.color is GREEN else "enrolled"
                        track.label = f"{kind} {_label_for(name, track.visitor_uuid)} ({sample_count} sample{'s' if sample_count != 1 else ''})"

                cv2.rectangle(frame, (x1, y1), (x2, y2), track.color, 2)
                cv2.putText(frame, track.label, (x1, max(y1 - 6, 0)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, track.color, 2)

            room = _room_names(tracker, face_db)
            if room != last_room:
                print(f"In frame now: {', '.join(room) if room else '(nobody)'}")
                last_room = room

            now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - prev_time, 1e-6))
            prev_time = now
            cv2.putText(frame, f"fps: {fps:.1f}  min_bbox_px: {cfg.min_bbox_px}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            room_text = f"In frame: {', '.join(room) if room else '(nobody)'}"
            cv2.putText(frame, room_text, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

            cv2.imshow("Recognition preview (q to quit)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        camera.stop()
        cv2.destroyAllWindows()
        face_db.close()


if __name__ == "__main__":
    main()
