$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskUrl = 'http://127.0.0.1:5173/'
try {
    $taskResponse = Invoke-WebRequest $taskUrl -TimeoutSec 3
    $taskStorageResponse = Invoke-WebRequest ($taskUrl + 'api/local-db') -TimeoutSec 3
    if ($taskResponse.StatusCode -eq 200 -and $taskResponse.Content.Contains('AI 短剧生产台') -and $taskStorageResponse.Headers['Content-Type'] -like '*application/json*') {
        Write-Host "AI Short Drama Studio is running: $taskUrl"
        exit 0
    }
} catch { }
if (-not (Test-Path -LiteralPath "$PSScriptRoot\dist\index.html")) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
}
$taskNode = (Get-Command node.exe).Source
Start-Process -FilePath $taskNode -ArgumentList @('scripts/serve-local.mjs') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot\preview-output.log" -RedirectStandardError "$PSScriptRoot\preview-error.log"
Start-Sleep -Seconds 2
$taskResponse = Invoke-WebRequest $taskUrl -TimeoutSec 10
if ($taskResponse.StatusCode -ne 200 -or -not $taskResponse.Content.Contains('AI 短剧生产台')) { throw 'The expected studio did not start. Check preview-error.log.' }
Write-Host "AI Short Drama Studio is running: $taskUrl"
