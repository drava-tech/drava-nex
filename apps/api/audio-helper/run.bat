@echo off
REM Launches the audio bridge (native Windows host — controls system
REM volume/mute via NAudio/WASAPI, which can't run inside the Linux API
REM container). Registered as the Scheduled Task "AudioBridge" (at-logon
REM trigger); mirrors ProductVisionCamera / VisionFaceCamera.
cd /d "%~dp0"
node --env-file=.env bridge.mjs
