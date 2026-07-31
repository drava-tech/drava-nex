@echo off
REM Launches the screen agent (native Windows host — moves the real OS mouse
REM cursor from a CMS tablet touchpad; requires nut-js's native input
REM bindings, which can't run inside the Linux API container). Registered as
REM the Scheduled Task "ScreenAgent" (at-logon trigger); mirrors AudioBridge /
REM VisionFaceCamera. Run "npm install" here once before first use.
cd /d "%~dp0"
node --env-file=.env agent.mjs
