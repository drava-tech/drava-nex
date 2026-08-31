import pytest
import struct
from server.protocol import unpack_frame

def test_unpack_frame_success():
    payload = b"hello world jpeg"
    header = struct.pack("<BQ", 1, 42)
    data = header + payload
    
    frame_type, frame_id, out_payload = unpack_frame(data)
    assert frame_type == 1
    assert frame_id == 42
    assert out_payload == payload

def test_unpack_frame_too_short():
    with pytest.raises(ValueError):
        unpack_frame(b"\x01\x02\x03")
