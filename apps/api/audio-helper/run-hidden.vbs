' Launches run.bat with no visible console window (WshShell.Run style 0 =
' hidden). The AudioBridge scheduled task runs InteractiveToken — WASAPI
' volume control needs the logged-in user's audio session — so without this
' wrapper Task Scheduler pops a cmd window on every logon, and closing that
' window kills the bridge (and the audio-helper.exe child) with it.
'
' run.bat redirects stdout/stderr to bridge.log, so hiding the window does
' not throw away the "Registration rejected" / missing-env diagnostics that
' are otherwise the only sign the bridge failed to start.
'
' The path is derived rather than hardcoded (unlike services/vision's copy),
' so this file works unchanged on any screen PC regardless of checkout path.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
' bWaitOnReturn = True is deliberate: it keeps this shim alive for the
' lifetime of the helper, so the scheduled task stays in the Running state
' and Task Scheduler keeps supervising it. With False the shim returns
' instantly, the task reports success, and the configured
' RestartCount=999 / RestartInterval=1min crash-restart would never fire
' (that is the flaw in services/vision's copy of this pattern). The exit
' code is propagated so a crash registers as a failure, not a clean stop.
rc = shell.Run("""" & scriptDir & "\run.bat" & """", 0, True)
WScript.Quit rc
