[CmdletBinding()]
param(
    [string]$Gateway = 'http://127.0.0.1:8094',
    [string]$Token = 'change-this-local-token',
    [string]$Model = 'local.anthropic.qwen3.8-27b'
)

$ErrorActionPreference = 'Stop'
$headers = @{
    Authorization = "Bearer $Token"
    'anthropic-version' = '2023-06-01'
}

$health = Invoke-RestMethod -Uri "$Gateway/health" -TimeoutSec 5
if ($health.status -ne 'ok') { throw 'Gateway health failed.' }

$models = Invoke-RestMethod -Uri "$Gateway/v1/models?limit=1000" -Headers $headers -TimeoutSec 5
if ($Model -notin @($models.data.id)) { throw "Model not discovered: $Model" }

$body = @{
    model = $Model
    max_tokens = 128
    stream = $false
    messages = @(@{ role = 'user'; content = 'Reply with the single word PONG.' })
    output_config = @{ effort = 'low' }
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod -Method Post -Uri "$Gateway/v1/messages" `
    -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 120
$text = (@($response.content) | Where-Object type -eq 'text' | ForEach-Object text) -join ''
if ($text.Trim() -ne 'PONG') { throw "Expected PONG, received: $text" }

Write-Host 'PASS: health, discovery, inference and final text'

