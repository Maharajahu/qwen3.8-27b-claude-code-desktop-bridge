[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$LlamaServer,
    [Parameter(Mandatory)]
    [string]$Model,
    [string]$Mmproj,
    [switch]$Vision,
    [int]$TextContext = 200000,
    [int]$VisionContext = 131072,
    [int]$Port = 8093,
    [ValidateRange(0, 16)]
    [int]$MtpDraftTokens = 3,
    [double]$MtpPMin = 0.15
)

$ErrorActionPreference = 'Stop'
foreach ($path in @($LlamaServer, $Model)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required file is missing: $path"
    }
}
if ($Vision -and -not (Test-Path -LiteralPath $Mmproj -PathType Leaf)) {
    throw "Vision requested but mmproj is missing: $Mmproj"
}

$context = if ($Vision) { $VisionContext } else { $TextContext }
$arguments = @(
    '--model', $Model,
    '--alias', 'qwen3.8-27b-local',
    '--ctx-size', [string]$context,
    '--cache-type-k', 'q4_0',
    '--cache-type-v', 'q4_0',
    '--gpu-layers', 'all',
    '--split-mode', 'none',
    '--main-gpu', '0',
    '--override-tensor', '.*=CUDA0',
    '--flash-attn', 'on',
    '--batch-size', '2048',
    '--ubatch-size', '112',
    '--parallel', '1',
    '--fit', 'off',
    '--cache-ram', '0',
    '--jinja',
    '--reasoning', 'on',
    '--reasoning-budget', '-1',
    '--reasoning-preserve',
    '--reasoning-format', 'deepseek',
    '--temp', '1.0',
    '--top-p', '0.95',
    '--top-k', '20',
    '--min-p', '0.0',
    '--presence-penalty', '0.0',
    '--repeat-penalty', '1.0',
    '--metrics',
    '--host', '127.0.0.1',
    '--port', [string]$Port
)

if ($Vision) {
    $arguments += @('--mmproj', $Mmproj, '--image-min-tokens', '1024')
} else {
    $arguments += '--no-mmproj-auto'
}
if ($MtpDraftTokens -gt 0) {
    $arguments += @(
        '--spec-type', 'draft-mtp',
        '--spec-draft-n-max', [string]$MtpDraftTokens,
        '--spec-draft-n-min', '0',
        '--spec-draft-p-min', [string]$MtpPMin
    )
}

& $LlamaServer @arguments
exit $LASTEXITCODE

