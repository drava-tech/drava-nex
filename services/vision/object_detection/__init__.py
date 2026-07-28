"""
vision.object_detection — YOLO product/object detection.

Deliberately kept as a sibling subtree of the face-vision modules rather than
merged into them: ultralytics/PyTorch (its own bundled CUDA + cuDNN 9) and
insightface/onnxruntime-gpu load conflicting CUDA runtimes when imported into
the same process. Separate venvs, separate requirements, separate processes —
see ../README.md and ./README.md.

Importing this package is cheap: nothing here pulls in torch. The heavy imports
live inside `server.engine` functions so the protocol/HTTP/WS layers stay
testable without a GPU or a torch install.
"""
