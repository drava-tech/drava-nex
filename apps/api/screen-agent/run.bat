@echo off
REM Launches the screen agent (native Windows host — moves the real OS mouse
REM cursor from a CMS tablet touchpad; requires nut-js's native input
REM bindings, which can't run inside the Linux API container). Registered as
REM the Scheduled Task "ScreenAgent" (at-logon trigger); mirrors AudioBridge /
REM VisionFaceCamera. Run "npm install" here once before first use.
cd /d "%~dp0"
REM Logged rather than shown: this runs hidden (run-hidden.vbs), so the
REM console diagnostics would otherwise be lost. Self-erasing — at ~2 MB the
REM live log is moved OVER the single previous generation, so the pair can
REM never exceed ~4 MB and there is nothing to clean up.
set "LOG=%~dp0agent.log"
if exist "%LOG%" for %%A in ("%LOG%") do if %%~zA GTR 2097152 move /y "%LOG%" "%LOG%.1" >nul
node --env-file=.env agent.mjs >> "%LOG%" 2>&1
