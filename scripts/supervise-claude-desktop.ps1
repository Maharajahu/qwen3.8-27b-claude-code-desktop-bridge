[CmdletBinding()]
param(
    [string]$Settings = (Join-Path $PSScriptRoot '..\runtime\background-settings.json')
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $repo 'runtime'
$logDir = Join-Path $runtime 'logs'
$healthUrl = 'http://127.0.0.1:8094/health'
$controlUrl = 'http://127.0.0.1:8094/control/unload'
$gatewayProcess = $null
$gatewayWasHealthy = $false
$unloadIssued = $false

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Test-Path -LiteralPath $Settings -PathType Leaf)) {
    throw "Background settings are missing: $Settings. Run install-background-gateway.ps1 first."
}
$config = Get-Content -Raw -LiteralPath $Settings | ConvertFrom-Json
$node = (Get-Command node.exe -ErrorAction Stop).Source
$gateway = Join-Path $repo 'src\gateway.mjs'
$lifecycleLog = Join-Path $logDir 'lifecycle.log'

function Write-LifecycleLog([string]$Message) {
    Add-Content -LiteralPath $lifecycleLog -Value ("{0:o} {1}" -f (Get-Date), $Message)
}

function Test-GatewayHealthy {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        return $health.service -eq 'qwen-claude-code-bridge'
    } catch {
        return $false
    }
}

function Get-ClaudeState {
    try {
        $processes = @(Get-Process -Name claude -ErrorAction SilentlyContinue)
        return [pscustomobject]@{
            Running = $processes.Count -gt 0
            WindowVisible = @($processes | Where-Object MainWindowHandle -ne 0).Count -gt 0
        }
    } catch {
        Write-LifecycleLog "Claude process check failed: $($_.Exception.Message)"
        return [pscustomobject]@{ Running = $true; WindowVisible = $true }
    }
}

function Invoke-ModelUnload {
    try {
        $headers = @{}
        if ($config.token) { $headers.Authorization = "Bearer $($config.token)" }
        Invoke-RestMethod -Uri $controlUrl -Method Post -Headers $headers `
            -ContentType 'application/json' -Body '{}' -TimeoutSec 10 | Out-Null
        Write-LifecycleLog 'model unload queued'
        return $true
    } catch {
        Write-LifecycleLog "model unload failed: $($_.Exception.Message)"
        return $false
    }
}

function Start-Gateway {
    $env:QWEN_CLAUDE_CONFIG = [string]$config.config
    $env:QWEN_CLAUDE_UPSTREAM = [string]$config.upstream
    $env:QWEN_CLAUDE_ROUTER_CONTROL = [string]$config.router_control
    $env:QWEN_CLAUDE_ROUTER_OWNER = 'claude-desktop'
    $env:QWEN_CLAUDE_TOKEN = [string]$config.token
    $env:QWEN_CLAUDE_PORT = [string]$config.port

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $logDir "$stamp.stdout.log"
    $stderr = Join-Path $logDir "$stamp.stderr.log"
    $script:gatewayProcess = Start-Process -FilePath $node -ArgumentList ('"' + $gateway + '"') `
        -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr -PassThru
    Write-LifecycleLog "gateway started pid=$($script:gatewayProcess.Id)"
}

$claudeState = Get-ClaudeState
Write-LifecycleLog "supervisor started running=$($claudeState.Running) window_visible=$($claudeState.WindowVisible)"

while ($true) {
    if ($gatewayProcess -and $gatewayProcess.HasExited) {
        Write-LifecycleLog "gateway exited code=$($gatewayProcess.ExitCode); restarting"
        $gatewayProcess = $null
        $gatewayWasHealthy = $false
        Start-Sleep -Seconds 2
    }

    $gatewayHealthy = Test-GatewayHealthy
    if (-not $gatewayHealthy -and -not $gatewayProcess) {
        Start-Gateway
    }

    $newClaudeState = Get-ClaudeState
    $closed = ($claudeState.Running -and -not $newClaudeState.Running) -or
        ($claudeState.WindowVisible -and -not $newClaudeState.WindowVisible)
    if (($closed -or (-not $newClaudeState.Running -and -not $newClaudeState.WindowVisible)) -and -not $unloadIssued) {
        if ($gatewayHealthy) { $unloadIssued = Invoke-ModelUnload }
    }
    if ($newClaudeState.Running -and $newClaudeState.WindowVisible) {
        $unloadIssued = $false
    }

    $claudeState = $newClaudeState
    $gatewayWasHealthy = $gatewayHealthy
    Start-Sleep -Seconds 2
}

