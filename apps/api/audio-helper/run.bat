@echo off
REM Launches the audio bridge (native Windows host — controls system
REM volume/mute via NAudio/WASAPI, which can't run inside the Linux API
REM container). Registered as the Scheduled Task "AudioBridge" (at-logon
REM trigger); mirrors ProductVisionCamera / VisionFaceCamera.
cd /d "%~dp0"
REM Logged rather than shown: this runs hidden (run-hidden.vbs), so the
REM console diagnostics would otherwise be lost. Self-erasing — at ~2 MB the
REM live log is moved OVER the single previous generation, so the pair can
REM never exceed ~4 MB and there is nothing to clean up.
set "LOG=%~dp0bridge.log"
if exist "%LOG%" for %%A in ("%LOG%") do if %%~zA GTR 2097152 move /y "%LOG%" "%LOG%.1" >nul
node --env-file=.env bridge.mjs >> "%LOG%" 2>&1
