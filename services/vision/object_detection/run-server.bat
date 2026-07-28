@echo off
REM Launches the YOLO inference server on the native Windows host (RTX 3090).
REM Its own venv, its own process — torch and the face pipeline's
REM onnxruntime-gpu bundle conflicting CUDA/cuDNN runtimes and must never share
REM one. Mirrors the sibling ..\run.bat for face vision.
REM
REM Serves ws://localhost:8000/vision/ws plus /vision/healthz|readyz|info.
REM Config comes from object_detection\.env (copy from .env.example).
cd /d "%~dp0"
cd ..\..
vision\object_detection\.venv\Scripts\python.exe -m vision.object_detection.server
