"""
object.py — product/object detection worker (NOT YET IMPLEMENTED).

Placeholder so the import tree and supervisor wiring are complete. When built,
this runs the YOLO pipeline (ultralytics + torch, cuDNN 9) in its own
subprocess and emits PRODUCT_DETECTED via events.emit_product(...).
"""

# TODO: YOLO pipeline for product detection (see engines/object.py).
raise NotImplementedError("Object detection worker not yet implemented.")
