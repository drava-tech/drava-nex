@echo off
REM Launches the face-vision pipeline (native Windows host — RealSense can't
REM pass through Docker Desktop). Registered as the Scheduled Task
REM "VisionFaceCamera" (at-logon trigger) so it survives a reboot.
REM
REM Object detection is NOT started here — it runs as its own process from its
REM own venv (conflicting CUDA stacks); see object_detection\run-server.bat.
cd /d "%~dp0"
set VISION_CAMERAS=[{"id":"cam-entrance","mode":"PEOPLE","backend":"realsense","index":0}]
cd ..
vision\.venv\Scripts\python.exe -m vision
