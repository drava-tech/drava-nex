"""
Makes `services/` importable so `vision.object_detection.*` resolves however
pytest is invoked (from services/, from object_detection/, or via an IDE).

Nothing here imports torch — see requirements-test.txt for the GPU-free path.
"""

import sys
from pathlib import Path

# tests/ → object_detection/ → vision/ → services/
_SERVICES_ROOT = Path(__file__).resolve().parents[3]
if str(_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICES_ROOT))
