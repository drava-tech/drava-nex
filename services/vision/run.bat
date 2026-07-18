@echo off
REM Launches the face-vision pipeline (native Windows host — RealSense can't
REM pass through Docker Desktop). Registered as the Scheduled Task
REM "VisionFaceCamera" (at-logon trigger) so it survives a reboot; mirrors the
REM sibling ProductVisionCamera task for services/product-vision.
cd /d "%~dp0"
set VISION_CAMERAS=[{"id":"cam-entrance","mode":"PEOPLE","backend":"realsense","index":0}]
cd ..
vision\.venv\Scripts\python.exe -m vision
