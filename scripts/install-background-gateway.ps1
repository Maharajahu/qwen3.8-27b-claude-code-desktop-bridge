[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot '..\config\models.json'),
    [string]$Upstream = 'http://127.0.0.1:8092/v1',
    [string]$RouterControl = 'http://127.0.0.1:8092/control',
    [string]$Token = '',
    [ValidateRange(1, 65535)]
    [int]$Port = 8094,
    [string]$TaskName = 'QwenClaudeDesktopBridge',
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = (Resolve-Path $Config).Path
$runtime = Join-Path $repo 'runtime'
$settingsPath = Join-Path $runtime 'background-settings.json'
$launcher = Join-Path $PSScriptRoot 'run-supervisor-hidden.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
[ordered]@{
    config = $configPath
    upstream = $Upstream
    router_control = $RouterControl
    token = $Token
    port = $Port
} | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding utf8

$action = New-ScheduledTaskAction -Execute $wscript -Argument ('"' + $launcher + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $taskSettings `
    -Description 'Headless Qwen bridge and Claude Code Desktop model lifecycle supervisor.' -Force | Out-Null

if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }

Write-Host "Installed hidden task: $TaskName"
Write-Host "Local settings: $settingsPath"

