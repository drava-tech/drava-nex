"""
angle_sampling.py — capture embedding samples spread across head-turn angles
for a visitor, instead of just the one embedding from whichever single frame
triggered their original enrollment. Each captured sample also gets its own
saved photo, so multiple angles can be reviewed visually, not just matched
numerically.

Shared by test_rtsp_pipeline_postgres.py and preview_recognition.py.

Yaw is estimated cheaply from the 5-point landmarks the detector already
returns (no separate pose model needed): how far the nose sits from the
eye-center line, normalized by interocular distance.

Real failure observed in testing (not hypothetical): a person enrolled with
only one starting sample was seen again shortly after, from a different
angle/framing, didn't match their single stored embedding closely enough,
and got silently enrolled a second time under a new uuid — same physical
person, two DB rows, one of them re-prompting for a name that had already
been given. Two changes fix this:

  1. face_for_track() + collect_diverse_samples(): rather than deciding off
     a single frame (track.best_face, which tracker.py only updates when a
     frame's quality exceeds every prior frame for that track — so within
     one continuous track it barely changes), the calling pipeline collects
     the *actual* per-frame face across the whole pending-confirmation
     window and keeps one representative per distinct yaw bucket. A
     brand-new visitor then starts with several stored angles instead of
     one, and a to-be-matched track gets several chances to find their
     existing record instead of one.
  2. seed_samples(): stores (embedding + numbered photo) for each of those
     collected samples in one call, whether the track ended up enrolled or
     matched.

maybe_capture_more() is separate and still useful after identification: for
a track that stays in frame a long time, or a visitor seen the cooldown
window later, it keeps widening coverage using the single current best_face
per call (not a full pending-window collection, since there's no equivalent
"confirmation window" once already identified).

Second failure observed in testing: someone enrolled while looking down at
their desk didn't match their own later, normal frontal view — one bad-pose
sample became a person's *only* embedding, and it just wasn't representative
enough. is_good_quality() gates every sample used for enrollment/matching on
detection confidence, a cheap vertical-pose sanity check (nose position and
face aspect ratio relative to the eye-line/mouth-line — a proxy for pitch,
which yaw_bucket() alone doesn't catch), and blur/brightness. If nothing in
a track's confirmation window passes, the caller should not enroll/match
yet — better to keep waiting for a usable frame than register an unreliable
one.

Samples are tracked as (face, source_frame) pairs, not bare faces — a track's
confirmation window spans several frames, and cropping/quality-checking a
sample against anything other than the exact frame it came from would be
checking/saving the wrong pixels (a real bug caught while adding the
blur/brightness check below, which needs actual pixel data per sample).

Photos are saved one folder per person (person_folder_name()) rather than
flat in image_dir — named after them, not just their uuid, for easy manual
review. The name alone isn't safe as the folder name: two different real
people can share a name (seen in testing — two different test visitors both
ended up named "TestName"), so the folder is "{name}_{short-uuid}", which
stays human-readable but never collides between two different actual
people. The first enrollment photo is saved by the caller (storage.py's
save_face_crop(), flat, before the name is known — see
test_rtsp_pipeline_postgres.py) and moved into the folder once naming
happens; every sample after that is saved directly into the folder here.
"""

from __future__ import annotations
import os
import re
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from vision.config import Config

YAW_BUCKET_EDGES = (-0.12, -0.04, 0.04, 0.12)
# Pitch (up/down tilt) uses the same nose_position ratio as the pose sanity
# check below, bucketed the same shape as yaw's 5 buckets but narrower —
# NOSE_POSITION_RANGE (0.25-0.75) is a tighter valid window than yaw ever
# gets clamped to, and natural head movement varies pitch far less than yaw
# during normal walking (people turn their head side to side far more than
# they nod). Roll (sideways head tilt) comes from the eye-line's own slope —
# ~0 for a level head, growing as the head tilts toward either shoulder.
PITCH_BUCKET_EDGES = (0.35, 0.45, 0.55, 0.65)
ROLL_BUCKET_EDGES = (-0.12, -0.04, 0.04, 0.12)
MAX_TOTAL_SAMPLES_PER_VISITOR = 10  # across all sightings/track instances, ever

# Config.image_dir defaults to a relative "./data/faces" (config.py), resolved
# against the process's CURRENT WORKING DIRECTORY at runtime — not anchored
# to this file's location. Real, repeated footgun in testing: running any of
# these scripts from inside scripts/ instead of
# services/vision/ silently creates a second, wrong data/faces/ folder right
# there (and once even left a real enrolled visitor's row pointing at a photo
# that didn't exist anywhere sensible). This file's own location is fixed —
# services/vision/angle_sampling.py — so deriving
# an absolute path from here instead of from cwd is footgun-proof regardless
# of where a script gets invoked from.
VISION_ROOT = os.path.dirname(os.path.abspath(__file__))


def absolute_image_dir() -> str:
    """Pass this as Config(..., image_dir=absolute_image_dir()) in every
    script instead of relying on Config's relative default."""
    return os.path.join(VISION_ROOT, "data", "faces")


def make_config(**overrides) -> Config:
    """Build a Config with image_dir ALWAYS forced to absolute_image_dir() —
    every script used to have to remember to pass image_dir=absolute_image_dir()
    itself, and forgetting it was a real, repeated footgun (see
    absolute_image_dir()'s docstring). Using this factory instead of calling
    Config(...) directly makes that impossible to forget: any future script
    that uses make_config() gets the correct directory automatically. Pass
    every other Config field the same way you would to Config() itself."""
    overrides["image_dir"] = absolute_image_dir()
    return Config(**overrides)

# Matches storage.py's CROP_MARGIN exactly, so numbered sample photos look
# consistent with the primary {uuid}.jpg enrollment photo.
CROP_MARGIN = 0.25

MIN_DET_SCORE_FOR_ENROLLMENT = 0.5
# Nose should sit roughly between the eye-line and mouth-line for a mostly-
# level, frontal face; pitching the head up/down pushes it toward either
# extreme. Range is a deliberately loose heuristic, not a calibrated model.
NOSE_POSITION_RANGE = (0.25, 0.75)
# Vertical (eye-to-mouth) span vs. horizontal (interocular) span should stay
# within a plausible ratio for a mostly-frontal face; a squashed or
# stretched ratio indicates a pitch/roll too extreme for a reliable embedding.
FACE_ASPECT_RANGE = (0.5, 1.6)
# Real failure found in testing: a person captured extremely close to the
# camera at a steep downward angle produced 10 samples that ALL passed
# NOSE_POSITION_RANGE/FACE_ASPECT_RANGE (both normalized against interocular
# distance, not the bbox itself) despite showing mostly forehead/glasses —
# no chin or mouth visible. Confirmed by re-running our own detector on the
# saved crops: 0 of 10 could even be re-detected as a face in isolation, yet
# they'd all passed the ratio checks. These two catch that specific failure
# mode (not yet validated against a broader real dataset, same as the
# ratio checks above when first written — revisit as more real cases turn
# up):
#   - BBOX_ASPECT_RANGE: the detector's own bbox width/height. A genuine
#     frontal face bbox is roughly square-ish; a badly foreshortened/
#     cropped detection tends to skew outside that.
#   - MIN_LANDMARK_MARGIN_FRAC: eyes/mouth should sit at least this fraction
#     of the bbox height away from its top/bottom edge — i.e. there should
#     be visible forehead above the eyes AND visible chin below the mouth.
#     Catches "face" crops with the chin (or forehead) cut off, which the
#     interocular-normalized ratios above don't check for at all.
BBOX_ASPECT_RANGE = (0.65, 1.35)
MIN_LANDMARK_MARGIN_FRAC = 0.12

# Laplacian variance is NOT portable across cameras — its scale depends on
# sensor noise, in-camera sharpening, and video compression, all of which
# differ per device. Measured on this Tapo TC70's actual feed across every
# real sample stored so far (28 photos, 6 real people): every single one
# landed at 679.5 or above, most in the 900-1600 range, some up to 5800+ —
# the old 150.0 threshold sat 4.5x below the lowest real value ever
# observed, so in practice it never once rejected anything (confirmed via
# quality_diagnostics.py: zero FAILs due to blur across a live 20s capture,
# even during natural movement). Correlating each sample's actual blur
# against how far its embedding sits from that same person's OTHER stored
# samples (a direct proxy for "does this sample risk causing a duplicate
# registration") gave a real but moderate negative correlation (Pearson
# -0.315 across 26 samples) — lower blur does associate with less
# representative embeddings, just not as strongly as pose/lighting. Raised
# to 500.0: comfortably below every real sample seen so far (zero risk of
# rejecting known-good data) while actually being reachable by a genuinely
# blurry frame, unlike 150.0. Still not validated against a true negative —
# revisit if real motion-blurred frames turn out to still pass.
MIN_BLUR_VARIANCE = 500.0
# Absolute brightness (0-255 grayscale mean) — unlike blur variance this
# scale IS portable across cameras, so these are generic "way too dark" /
# "way too bright" bounds rather than something camera-specific to tune.
MIN_BRIGHTNESS = 35.0
MAX_BRIGHTNESS = 225.0

# Temporal verification + no-auto-registration-on-a-hunch: a track is never
# matched OR registered off a single frame. Every good sample independently
# votes (via vote_identity()) for whichever visitor_uuid it's nearest to
# (or None, meaning "nobody in the DB is close enough") — only once enough
# samples agree do we act. MIN_SAMPLES_FOR_VOTE gates matching an existing
# person (fast — a known person should be recognized quickly); registering
# a brand-new person requires more evidence (MIN_SAMPLES_TO_REGISTER) since
# creating a new identity is a much more consequential, harder-to-reverse
# action than recognizing an existing one.
MIN_SAMPLES_FOR_VOTE = 3
MIN_SAMPLES_TO_REGISTER = 5
MAJORITY_VOTE_THRESHOLD = 0.6
# MIN_SAMPLES_TO_REGISTER alone only checks COUNT, not actual angle spread —
# someone who barely turns their head during the whole sighting (e.g. walks
# straight toward the camera) could rack up 5 near-identical-angle samples,
# satisfying the count while building a profile that can't recognize them
# from a genuinely different angle later (the same failure mode multi-angle
# capture was built to prevent in the first place, just moved one level
# up). YAW_BUCKET_EDGES defines 5 possible buckets; require real spread
# across at least 3 of them before registering, not just 5 samples.
MIN_YAW_BUCKETS_TO_REGISTER = 3
# Yaw diversity alone isn't full coverage either — a real failure found in
# testing: 10 samples spanning multiple yaw buckets ALL shared the same
# steep, close-up downward pitch (mostly forehead/glasses, no visible
# chin), because nothing checked vertical spread at all. Lower bar than yaw
# (2 vs 3) since pitch naturally varies far less during normal movement —
# requiring the same 3 would make registration impractically rare.
MIN_PITCH_BUCKETS_TO_REGISTER = 2
# Safety cap on the raw (pre-quality-filter) per-track sample buffer, so a
# track that lingers a long time without ever reaching a confident decision
# (an inconclusive, flickering case) doesn't grow its buffer unboundedly.
MAX_PENDING_RAW_SAMPLES = 60

# Shared by test_rtsp_pipeline_postgres.py and assign_names.py: a lightweight
# cv2 preview window instead of os.startfile() handing a photo to the OS's
# default image viewer. That used to be the modern Windows Photos app, a
# slow-cold-starting UWP app that opens a full gallery/filmstrip of the whole
# folder rather than just one photo — fired repeatedly in a busy scene
# (several enrollments a few seconds apart), it kept getting re-triggered
# before it had even finished rendering the previous photo, so the window
# that popped up was still blank/loading. cv2.imshow has no cold start and
# reuses the same OS window on the next call instead of spawning a new app
# instance, so consecutive prompts update in place.
PREVIEW_WINDOW = "Who is this? (naming prompt is in the terminal)"
PREVIEW_MIN_SIDE = 320  # crops are tight face-only jpegs (~60-150px) — too small to judge a face at native size


def show_photo_preview_bytes(image_bytes: Optional[bytes]) -> bool:
    """Show a JPEG held in memory — the DB-stored crop bytes (from
    FaceRecognitionDb.get_primary_image()) — in the shared preview window.
    Replaces reading a file off disk now that crops live in the DB. Returns
    False (caller should log a warning) if the bytes are empty or can't be
    decoded."""
    if not image_bytes:
        return False
    img = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return False
    h, w = img.shape[:2]
    scale = max(1.0, PREVIEW_MIN_SIDE / min(h, w))
    if scale > 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LINEAR)
    cv2.namedWindow(PREVIEW_WINDOW, cv2.WINDOW_AUTOSIZE)
    cv2.imshow(PREVIEW_WINDOW, img)
    cv2.waitKey(1)  # pump the event loop once so the window paints before input() blocks
    return True


def close_photo_preview() -> None:
    cv2.destroyWindow(PREVIEW_WINDOW)


@dataclass
class FrameSample:
    face: object  # insightface Face — .bbox, .det_score, .kps, .normed_embedding
    frame: np.ndarray  # the exact frame this face was detected in


_INVALID_FOLDER_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def person_folder_name(name: Optional[str], visitor_uuid: str) -> str:
    """Folder name for a person's saved photos: "{name}_{short-uuid}", or
    "Unnamed_{short-uuid}" if they haven't been named yet. The uuid suffix
    is load-bearing, not decorative — two different real people can share a
    name, and without it their photos would land in the same folder."""
    base = (name or "").strip()
    base = _INVALID_FOLDER_CHARS.sub("", base)[:80]
    return f"{base or 'Unnamed'}_{visitor_uuid[:8]}"


def _crop_tight(frame_bgr: np.ndarray, bbox) -> Optional[np.ndarray]:
    h, w = frame_bgr.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in bbox[:4])
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    return frame_bgr[y1:y2, x1:x2]


def is_good_quality(sample: FrameSample, min_det_score: float = MIN_DET_SCORE_FOR_ENROLLMENT) -> bool:
    """True if this sample is frontal, sharp, and well-lit enough to trust
    for enrollment or matching. See module docstring for the failures this
    guards against."""
    face = sample.face
    if float(face.det_score) < min_det_score:
        return False

    left_eye, right_eye, nose, left_mouth, right_mouth = face.kps[:5]
    interocular = abs(right_eye[0] - left_eye[0])
    if interocular < 1e-3:
        return False
    eye_center_y = (left_eye[1] + right_eye[1]) / 2
    mouth_center_y = (left_mouth[1] + right_mouth[1]) / 2
    face_span = mouth_center_y - eye_center_y
    if face_span < 1e-3:
        return False
    nose_position = (nose[1] - eye_center_y) / face_span
    if not (NOSE_POSITION_RANGE[0] <= nose_position <= NOSE_POSITION_RANGE[1]):
        return False
    aspect = face_span / interocular
    if not (FACE_ASPECT_RANGE[0] <= aspect <= FACE_ASPECT_RANGE[1]):
        return False

    # Both checks above are normalized against interocular distance, not the
    # bbox itself — they can still pass on a badly cropped/foreshortened
    # detection (e.g. extreme close-up, chin cut off) that only shows part
    # of a face. See module comment above BBOX_ASPECT_RANGE for the real
    # case this catches.
    x1, y1, x2, y2 = (float(v) for v in face.bbox[:4])
    bbox_w, bbox_h = x2 - x1, y2 - y1
    if bbox_h < 1e-3:
        return False
    if not (BBOX_ASPECT_RANGE[0] <= bbox_w / bbox_h <= BBOX_ASPECT_RANGE[1]):
        return False
    top_margin = (eye_center_y - y1) / bbox_h
    bottom_margin = (y2 - mouth_center_y) / bbox_h
    if top_margin < MIN_LANDMARK_MARGIN_FRAC or bottom_margin < MIN_LANDMARK_MARGIN_FRAC:
        return False

    crop = _crop_tight(sample.frame, face.bbox)
    if crop is None:
        return False
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean())
    if not (MIN_BRIGHTNESS <= brightness <= MAX_BRIGHTNESS):
        return False
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if blur < MIN_BLUR_VARIANCE:
        return False

    return True


def filter_good_quality(samples: list) -> list:
    return [s for s in samples if is_good_quality(s)]


def sample_quality_score(sample: FrameSample) -> float:
    """Composite 0-1ish ranking of one sample against another of the SAME
    person — det_score (the model's own confidence), how centered/frontal
    the pose is, and blur, combined. Higher is better. Used once a visitor
    is already at MAX_TOTAL_SAMPLES_PER_VISITOR: a newly captured sample
    that outranks their current worst stored one replaces it, instead of
    just being dropped — so 10 good early samples don't permanently lock
    out better ones captured later."""
    face = sample.face
    left_eye, right_eye, nose, left_mouth, right_mouth = face.kps[:5]
    interocular = abs(right_eye[0] - left_eye[0])
    eye_center_y = (left_eye[1] + right_eye[1]) / 2
    mouth_center_y = (left_mouth[1] + right_mouth[1]) / 2
    face_span = mouth_center_y - eye_center_y
    nose_position = (nose[1] - eye_center_y) / face_span if abs(face_span) > 1e-3 else 0.5
    aspect = face_span / interocular if interocular > 1e-3 else 1.0
    # Distance from "ideal" centered/frontal (nose_position=0.5, aspect=1.0),
    # normalized against each range's own half-width so neither dominates.
    pose_penalty = abs(nose_position - 0.5) / 0.25 + abs(aspect - 1.0) / 0.6
    pose_score = max(0.0, 1.0 - pose_penalty / 2)

    blur_score = 0.0
    crop = _crop_tight(sample.frame, face.bbox)
    if crop is not None:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        # 1500 ~= comfortably sharp based on this camera's real observed
        # range (679-5852, see MIN_BLUR_VARIANCE) — not a hard ceiling,
        # just where more sharpness stops mattering for this score.
        blur_score = min(blur / 1500.0, 1.0)

    return 0.4 * float(face.det_score) + 0.3 * pose_score + 0.3 * blur_score


def yaw_bucket(kps) -> int:
    left_eye, right_eye, nose = kps[0], kps[1], kps[2]
    interocular = abs(right_eye[0] - left_eye[0])
    if interocular < 1e-3:
        return 0
    ratio = (nose[0] - (left_eye[0] + right_eye[0]) / 2) / interocular
    bucket = 0
    for edge in YAW_BUCKET_EDGES:
        if ratio >= edge:
            bucket += 1
    return bucket


def pitch_bucket(kps) -> int:
    """Same idea as yaw_bucket() but for vertical (up/down) angle — reuses
    the nose_position ratio from is_good_quality()'s pose check, bucketed
    instead of thresholded."""
    left_eye, right_eye, nose, left_mouth, right_mouth = kps[:5]
    eye_center_y = (left_eye[1] + right_eye[1]) / 2
    mouth_center_y = (left_mouth[1] + right_mouth[1]) / 2
    face_span = mouth_center_y - eye_center_y
    if abs(face_span) < 1e-3:
        return 0
    nose_position = (nose[1] - eye_center_y) / face_span
    bucket = 0
    for edge in PITCH_BUCKET_EDGES:
        if nose_position >= edge:
            bucket += 1
    return bucket


def roll_bucket(kps) -> int:
    """Sideways head-tilt bucket, from the eye-line's own slope — ~level
    for an upright head, growing as the head tilts toward either shoulder."""
    left_eye, right_eye = kps[0], kps[1]
    dx = right_eye[0] - left_eye[0]
    if abs(dx) < 1e-3:
        return 0
    ratio = (right_eye[1] - left_eye[1]) / dx
    bucket = 0
    for edge in ROLL_BUCKET_EDGES:
        if ratio >= edge:
            bucket += 1
    return bucket


def angle_bucket(kps) -> tuple[int, int]:
    """Combined (yaw, pitch) bucket — the two axes that actually matter for
    "does this profile cover a genuinely different view of the face", used
    together wherever angle diversity is required or selected for."""
    return yaw_bucket(kps), pitch_bucket(kps)


def face_for_track(track, faces: list):
    """tracker.update() sets track.bbox to the current frame's matched
    face's bbox — find that exact Face object in `faces` (not just
    track.best_face, which only updates on quality improvement) so
    per-frame collection during the pending window sees genuine variation,
    not repeats of whichever frame was already the best."""
    for f in faces:
        fb = f.bbox
        if (abs(fb[0] - track.bbox[0]) < 1 and abs(fb[1] - track.bbox[1]) < 1
                and abs(fb[2] - track.bbox[2]) < 1 and abs(fb[3] - track.bbox[3]) < 1):
            return f
    return track.best_face


def collect_diverse_samples(samples: list, max_samples: int = 10) -> list:
    """From samples collected across several frames (e.g. a track's whole
    pending window), first keep one per distinct (yaw, pitch) bucket
    (first-seen wins) — real face coverage needs both axes, not just
    left-right (see MIN_PITCH_BUCKETS_TO_REGISTER's docstring for the real
    failure this fixes: samples spanning several yaw buckets that all
    shared the same bad pitch). Once angle buckets are exhausted, prefer
    samples with a distinct roll (head tilt) next; only after that does it
    fall back to plain time-spread filling, so a registration also captures
    expression/lighting variation over time rather than 5-10 near-duplicate
    frames. Always returns at least [samples[-1]] if samples is non-empty,
    so callers never get an empty list from a non-empty input."""
    if not samples:
        return []

    seen_angles: set[tuple[int, int]] = set()
    chosen: list[int] = []
    for i, s in enumerate(samples):
        key = angle_bucket(s.face.kps)
        if key in seen_angles:
            continue
        seen_angles.add(key)
        chosen.append(i)
        if len(chosen) >= max_samples:
            return [samples[i] for i in chosen]

    chosen_set = set(chosen)
    remaining = [i for i in range(len(samples)) if i not in chosen_set]
    seen_rolls = {roll_bucket(samples[i].face.kps) for i in chosen}
    still_remaining: list[int] = []
    for i in remaining:
        r = roll_bucket(samples[i].face.kps)
        if r in seen_rolls:
            still_remaining.append(i)
            continue
        seen_rolls.add(r)
        chosen.append(i)
        if len(chosen) >= max_samples:
            return [samples[i] for i in chosen]

    need = max_samples - len(chosen)
    if still_remaining and need > 0:
        step = max(1, len(still_remaining) // need)
        for i in still_remaining[::step]:
            chosen.append(i)
            if len(chosen) >= max_samples:
                break
    return [samples[i] for i in chosen] if chosen else samples[-1:]


def vote_identity(face_db, samples: list) -> tuple[Optional[str], float]:
    """Temporal verification: never decide identity off one sample. Every
    sample's embedding is matched against the DB independently, and each
    one "votes" for whichever visitor_uuid it's nearest to within
    match_max_distance, or None if nobody in the DB is close enough. Returns
    (majority choice, fraction of samples that agreed with it) — callers
    should only act on the result once that fraction clears
    MAJORITY_VOTE_THRESHOLD; a low fraction means the samples disagreed
    with each other (e.g. flickering between two candidates, or between a
    candidate and "nobody"), which is inconclusive rather than a decision
    either way."""
    votes: dict[Optional[str], int] = {}
    for s in samples:
        nearest = face_db.find_nearest(s.face.normed_embedding)
        choice = nearest[0] if nearest is not None and nearest[1] <= face_db.match_max_distance else None
        votes[choice] = votes.get(choice, 0) + 1
    best_choice = max(votes, key=votes.get)
    return best_choice, votes[best_choice] / len(samples)


def register_new_person(face_db, cfg, samples: list) -> str:
    """Auto-register a brand-new person — only call this once vote_identity()
    has confirmed, across MIN_SAMPLES_TO_REGISTER+ good samples spanning
    different angles, that nobody in the DB consistently matches them.
    Stores every collected sample's embedding + crop bytes in one shot
    (photos 1, 2, ...) into the DB, rather than one primary sample now and
    the rest trickling in later — by the time this is called, the diverse
    angle/expression/lighting samples a real registration wants already
    exist, so there's no reason to hold any of them back."""
    primary = samples[0]
    image_bytes = _encode_crop(primary.frame, primary.face.bbox)
    visitor_uuid = face_db.enroll(
        primary.face.normed_embedding, sample_quality_score(primary), image_bytes
    )
    folder_name = person_folder_name(None, visitor_uuid)
    # image_path is now just a non-null presence marker (crop bytes are in the
    # DB, stored by enroll() above) — keep it human-readable for reference.
    face_db.set_image(visitor_uuid, _logical_crop_path(folder_name, 1))
    seed_samples(face_db, cfg, visitor_uuid, None, samples, skip_first=True)
    return visitor_uuid


def rename_person_folder(face_db, cfg, visitor_uuid: str, name: str, old_image_path: str) -> None:
    """Naming someone after the fact updates their image_path marker from
    Unnamed_{uuid8}/… to {name}_{uuid8}/… so it stays human-readable and
    consistent with the name shown everywhere else. Crops now live in the DB,
    so there's no folder on disk to move — this only rewrites the marker
    string (the crop bytes are unaffected). No-op if there's no photo marker
    yet or the name-derived folder is unchanged."""
    if not old_image_path:
        return
    old_folder = os.path.dirname(old_image_path)
    new_folder = person_folder_name(name, visitor_uuid)
    if old_folder == new_folder:
        return
    new_image_path = os.path.join(new_folder, os.path.basename(old_image_path))
    face_db.set_image(visitor_uuid, new_image_path)


def _encode_crop(frame_bgr: np.ndarray, bbox) -> bytes | None:
    """Crop bbox (+margin, clamped to the frame) and JPEG-encode to bytes for
    DB storage. Same crop-with-margin logic as storage.save_face_crop, but
    NOTHING is written to disk — the bytes go straight into the database
    (visitor_embedding.image_bytes). Never raises — a missing sample photo
    must not abort a capture."""
    try:
        h, w = frame_bgr.shape[:2]
        x1, y1, x2, y2 = (float(v) for v in bbox[:4])
        mx = (x2 - x1) * CROP_MARGIN
        my = (y2 - y1) * CROP_MARGIN
        xa = max(0, int(x1 - mx))
        ya = max(0, int(y1 - my))
        xb = min(w, int(x2 + mx))
        yb = min(h, int(y2 + my))
        if xb - xa < 2 or yb - ya < 2:
            return None
        ok, buf = cv2.imencode(".jpg", frame_bgr[ya:yb, xa:xb])
        if not ok:
            return None
        return buf.tobytes()
    except Exception:
        return None


def _logical_crop_path(folder_name: str, sample_number: int) -> str:
    """The image_path marker string for a numbered sample (e.g.
    "Vamsi_56cdb423/02.jpg"). Kept only as a human-readable, non-null presence
    marker for the CMS `hasImage` flag — NO file exists at this path anymore;
    the crop bytes live in the DB."""
    return os.path.join(folder_name, f"{sample_number:02d}.jpg")


def _store_or_replace_sample(face_db, cfg, visitor_uuid: str, folder_name: str, sample: FrameSample) -> bool:
    """Store this sample as a new numbered photo if the visitor is under
    MAX_TOTAL_SAMPLES_PER_VISITOR; otherwise, only replace their current
    worst-ranked stored sample if this new one actually outranks it (see
    sample_quality_score()) — overwriting the same photo_number in place so
    no renumbering is needed. The crop is JPEG-encoded and stored in the DB
    (visitor_embedding.image_bytes), never on disk. `cfg`/`folder_name` are
    retained for signature stability; storage no longer touches the
    filesystem. Returns whether anything was stored/replaced."""
    score = sample_quality_score(sample)
    image_bytes = _encode_crop(sample.frame, sample.face.bbox)
    count = face_db.embedding_count(visitor_uuid)
    if count < MAX_TOTAL_SAMPLES_PER_VISITOR:
        photo_number = count + 1
        face_db.add_embedding_sample(
            visitor_uuid, sample.face.normed_embedding, score, photo_number, image_bytes
        )
        return True

    worst = face_db.worst_sample(visitor_uuid)
    if worst is None:
        return False
    worst_id, worst_photo_number, worst_score = worst
    if score <= worst_score:
        return False  # not better than what's already stored — keep the existing sample
    face_db.replace_sample(worst_id, sample.face.normed_embedding, score, image_bytes)
    # If the replaced slot is the primary (photo 1), keep the visitor's
    # representative crop (what the CMS serves) in sync with the better sample.
    if worst_photo_number == 1 and image_bytes is not None:
        face_db.set_primary_image(visitor_uuid, image_bytes)
    return True


def seed_samples(face_db, cfg, visitor_uuid: str, name: Optional[str], samples: list, skip_first: bool) -> None:
    """Store (embedding + numbered photo) for each collected sample, each
    cropped from its own source frame and saved into the person's folder
    (person_folder_name(name, visitor_uuid)). skip_first=True when the
    caller already stored samples[0] itself (the enroll() call's first
    sample, saved flat before the name was known and moved into the folder
    as 01.jpg by the caller) — everything after that is new here. Once at
    the cap, a better-quality sample still replaces the current worst one
    rather than being silently dropped (see _store_or_replace_sample())."""
    folder_name = person_folder_name(name, visitor_uuid)
    to_store = samples[1:] if skip_first else samples
    for s in to_store:
        _store_or_replace_sample(face_db, cfg, visitor_uuid, folder_name, s)


def maybe_capture_more(face_db, track, face, cfg, frame: np.ndarray, name: Optional[str]) -> bool:
    """For later frames of an already-identified track (no pending-window
    collection applies anymore — this is the single current frame). Returns
    True if a sample (and its photo) was captured or replaced an existing
    one. Tracks (yaw, pitch) combined buckets, not yaw alone — a track that
    keeps seeing the same angle shouldn't keep re-triggering this."""
    sample = FrameSample(face, frame)
    if not is_good_quality(sample):
        return False
    bucket = angle_bucket(face.kps)
    if bucket in track.captured_buckets:
        return False
    track.captured_buckets.add(bucket)
    folder_name = person_folder_name(name, track.visitor_uuid)
    return _store_or_replace_sample(face_db, cfg, track.visitor_uuid, folder_name, sample)
