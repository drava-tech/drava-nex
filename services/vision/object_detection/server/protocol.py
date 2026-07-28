import struct
from pydantic import BaseModel, Field

class Box(BaseModel):
    x: float
    y: float
    width: float
    height: float

class DetectionResult(BaseModel):
    classId: int
    label: str
    confidence: float
    box: Box

class ModelInfo(BaseModel):
    id: str
    version: str
    file: str

class InferenceInfo(BaseModel):
    provider: str
    device: str
    processingTimeMs: float

class SourceInfo(BaseModel):
    width: int
    height: int

class DetectionsMessage(BaseModel):
    type: str = "detections"
    frameId: int
    timestamp: str
    model: ModelInfo
    inference: InferenceInfo
    source: SourceInfo
    detections: list[DetectionResult]

def unpack_frame(data: bytes) -> tuple[int, int, bytes]:
    """Unpack a binary frame using the 9-byte header protocol.
    
    Header structure:
      - Byte 0: type (1 byte, uint8)
      - Bytes 1-8: frameId (8 bytes, uint64, Little Endian)
      - Bytes 9+: JPEG payload
    """
    if len(data) < 9:
        raise ValueError("Frame too short")
    frame_type, frame_id = struct.unpack_from("<BQ", data)
    payload = data[9:]
    return frame_type, frame_id, payload
