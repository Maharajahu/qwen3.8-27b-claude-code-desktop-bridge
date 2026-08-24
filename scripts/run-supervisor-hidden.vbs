Option Explicit

Dim shell, fileSystem, supervisor, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

supervisor = fileSystem.BuildPath(fileSystem.GetParentFolderName(WScript.ScriptFullName), "supervise-claude-desktop.ps1")
command = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & supervisor & """"

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

