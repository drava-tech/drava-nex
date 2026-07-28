"""Binary frame header + detection response shape.

This is the contract with packages/vision-browser/src/server-transport.ts:
  client → server  [type:1B=0x01][frameId:8B uint64 LE][JPEG bytes]
  server → client  {type:"detections", frameId, model, inference, source, detections[]}
Any change here breaks the CMS display flow, so the field names are asserted
literally rather than via the models.
"""

import struct

import pytest

from vision.object_detection.server.protocol import (
    Box,
    DetectionResult,
    DetectionsMessage,
    InferenceInfo,
    ModelInfo,
    SourceInfo,
    unpack_frame,
)


def test_unpack_frame_success():
    payload = b"hello world jpeg"
    header = struct.pack("<BQ", 1, 42)

    frame_type, frame_id, out_payload = unpack_frame(header + payload)
    assert frame_type == 1
    assert frame_id == 42
    assert out_payload == payload


def test_unpack_frame_too_short():
    with pytest.raises(ValueError):
        unpack_frame(b"\x01\x02\x03")


def test_unpack_frame_exactly_header_length_has_empty_payload():
    frame_type, frame_id, payload = unpack_frame(struct.pack("<BQ", 1, 7))
    assert (frame_type, frame_id, payload) == (1, 7, b"")


def test_unpack_frame_is_little_endian():
    """setBigUint64(1, id, true) on the browser side — LE, not native order."""
    frame_id = 0x0102030405060708
    _, parsed_id, _ = unpack_frame(struct.pack("<BQ", 1, frame_id) + b"x")
    assert parsed_id == frame_id


def test_unpack_frame_max_uint64_frame_id():
    _, parsed_id, _ = unpack_frame(struct.pack("<BQ", 1, 2**64 - 1))
    assert parsed_id == 2**64 - 1


def test_detections_message_shape_matches_browser_client():
    msg = DetectionsMessage(
        frameId=99,
        timestamp="2026-01-01T00:00:00Z",
        model=ModelInfo(id="coster", version="1.0.0", file="coster-v1.pt"),
        inference=InferenceInfo(provider="cuda", device="RTX 3090", processingTimeMs=12.5),
        source=SourceInfo(width=640, height=480),
        detections=[
            DetectionResult(
                classId=0,
                label="coster",
                confidence=0.91,
                box=Box(x=0.1, y=0.2, width=0.3, height=0.4),
            )
        ],
    )
    dumped = msg.model_dump()

    assert dumped["type"] == "detections"
    assert set(dumped) == {
        "type", "frameId", "timestamp", "model", "inference", "source", "detections",
    }
    assert set(dumped["model"]) == {"id", "version", "file"}
    assert set(dumped["inference"]) == {"provider", "device", "processingTimeMs"}
    assert set(dumped["source"]) == {"width", "height"}

    det = dumped["detections"][0]
    assert set(det) == {"classId", "label", "confidence", "box"}
    assert set(det["box"]) == {"x", "y", "width", "height"}


def test_box_is_normalised_0_to_1():
    """Boxes must be normalised — the browser scales them by its own video size."""
    det = DetectionResult(
        classId=0,
        label="coster",
        confidence=0.5,
        box=Box(x=0.25, y=0.5, width=0.25, height=0.25),
    )
    assert 0.0 <= det.box.x <= 1.0
    assert 0.0 <= det.box.y + det.box.height <= 1.0
