' Launches run.bat with no visible console window (WshShell.Run style 0 =
' hidden). The VisionFaceCamera scheduled task runs InteractiveToken (needs
' the logged-in desktop session for the RealSense camera), so without this
' wrapper Task Scheduler pops a visible cmd window every time it starts —
' and closing that window kills the coordinator + RealSense worker with it.
'
' run.bat is found next to this file rather than at a hardcoded path, so the
' checkout folder can be renamed or moved without editing this shim.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & scriptDir & "\run.bat" & """", 0, False
