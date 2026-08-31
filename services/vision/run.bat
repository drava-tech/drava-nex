@echo off
REM Launches the face-vision pipeline (native Windows host — RealSense can't
REM pass through Docker Desktop). Registered as the Scheduled Task
REM "VisionFaceCamera" (at-logon trigger) so it survives a reboot.
REM
REM Object detection is NOT started here — VISION_CAMERAS below only lists a
REM PEOPLE camera, and vision\.venv is the face venv. It runs as its own
REM process from its own venv (conflicting CUDA stacks) — see README.md's
REM "Object/product (OBJECT) setup" section.
cd /d "%~dp0"
set VISION_CAMERAS=[{"id":"cam-entrance","mode":"PEOPLE","backend":"realsense","index":0}]
cd ..
vision\.venv\Scripts\python.exe -m vision
