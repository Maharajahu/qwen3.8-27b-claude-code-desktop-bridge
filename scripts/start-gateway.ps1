[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot '..\config\models.json'),
    [string]$Upstream = 'http://127.0.0.1:8093/v1',
    [string]$Token = 'change-this-local-token',
    [int]$Port = 8094
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:QWEN_CLAUDE_CONFIG = (Resolve-Path $Config).Path
$env:QWEN_CLAUDE_UPSTREAM = $Upstream
$env:QWEN_CLAUDE_TOKEN = $Token
$env:QWEN_CLAUDE_PORT = [string]$Port

& node (Join-Path $repo 'src\gateway.mjs')
exit $LASTEXITCODE

