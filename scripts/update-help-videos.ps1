# Scans _demo/video for tutorial files and writes _demo/js/help-videos-embed.js
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { throw "Cannot resolve script directory." }
$root = [System.IO.Path]::GetFullPath((Join-Path $scriptDir ".."))

$videoDir = Join-Path $root "_demo\video"
$out = Join-Path $root "_demo\js\help-videos-embed.js"

if (-not (Test-Path -LiteralPath $videoDir)) {
  throw "Missing folder: $videoDir"
}

$exts = @(".mkv", ".mp4", ".webm", ".ogg")
$files = Get-ChildItem -LiteralPath $videoDir -File |
  Where-Object { $exts -contains $_.Extension.ToLowerInvariant() } |
  Sort-Object Name -Descending

$names = @($files | ForEach-Object { $_.Name })
$json = ConvertTo-Json -InputObject $names -Compress

$body = @"
/* Auto-updated by scripts/update-help-videos.ps1 */
window.__SEAM_HELP_VIDEOS = $json;
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($out, $body.TrimEnd() + "`n", $utf8NoBom)
Write-Host "Wrote $($files.Count) video(s) to $out"
