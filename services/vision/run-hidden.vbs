' Launches run.bat with no visible console window (WshShell.Run style 0 =
' hidden). The VisionFaceCamera scheduled task runs InteractiveToken (needs
' the logged-in desktop session for the RealSense camera), so without this
' wrapper Task Scheduler pops a visible cmd window every time it starts —
' and closing that window kills the coordinator + RealSense worker with it.
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & "e:\EC\cms-platform\services\vision\run.bat" & """", 0, False
