@echo off
rem Self-restarting loop: Task Scheduler's built-in "restart on failure" is
rem unreliable for logon-triggered tasks, so this handles restart-on-crash
rem itself instead — Task Scheduler only needs to launch this once at logon.
cd /d "%~dp0"
if not exist logs mkdir logs

:loop
echo %date% %time% - starting product-vision >> "logs\product-vision.log"
".venv\Scripts\pythonw.exe" src\main.py >> "logs\product-vision.log" 2>&1
echo %date% %time% - process exited, restarting in 5s >> "logs\product-vision.log"
ping -n 6 127.0.0.1 >nul
goto loop
