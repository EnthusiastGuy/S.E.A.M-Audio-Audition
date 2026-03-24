# Writes _demo after revision.txt + revision-embed.js. Same modes as update-revision.sh.
param(
  [Parameter(Position = 0)]
  [ValidateSet('head', 'push')]
  [string]$Mode = 'head'
)

$ErrorActionPreference = "Stop"
$root = git rev-parse --show-toplevel
if (-not $root) { throw "Not a git repository." }
$out = Join-Path $root "_demo\revision.txt"
$embed = Join-Path $root "_demo\js\revision-embed.js"

if ($Mode -eq 'push') {
  $hasUpstream = $true
  git rev-parse --verify "@{u}" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { $hasUpstream = $false }

  if ($hasUpstream) {
    $remoteCount = [int](git rev-list --count "@{u}")
    $aheadCount = [int](git rev-list --count "@{u}..HEAD")
    $revision = $remoteCount + $aheadCount
  } else {
    $revision = [int](git rev-list --count HEAD)
  }
} else {
  $revision = [int](git rev-list --count HEAD)
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($out, "$revision`n", $utf8NoBom)
$embedBody =
  "/* Auto-updated by scripts/update-revision.sh (or .ps1) together with ../revision.txt */`n" +
  "window.__SEAM_REVISION = $revision;`n"
[System.IO.File]::WriteAllText($embed, $embedBody, $utf8NoBom)
Write-Host "Wrote revision $revision to _demo/revision.txt and _demo/js/revision-embed.js (mode=$Mode)"
