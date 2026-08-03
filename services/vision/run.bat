@echo off
REM Launches the vision coordinator (native Windows host — RealSense can't
REM pass through Docker Desktop). Registered as the Scheduled Task
REM "VisionFaceCamera" (at-logon trigger) so it survives a reboot.
REM
REM The coordinator owns the single physical RealSense D455 and switches it
REM between PEOPLE (default) and OBJECT (while the CMS's "Object Recognition"
REM experience is live on any screen) by spawning the right worker from the
REM right venv — see coordinator.py. It runs from the face venv itself
REM (.venv) since it never imports torch/onnxruntime directly, only
REM subprocess.Popen's into whichever venv the active mode needs.
REM
REM Do NOT also run supervisor.py (`python -m vision`) against this same
REM camera while the coordinator is running — only one process may hold the
REM RealSense device at a time.
cd /d "%~dp0"
cd ..
vision\.venv\Scripts\python.exe -m vision.coordinator >> vision\coordinator.log 2>&1
