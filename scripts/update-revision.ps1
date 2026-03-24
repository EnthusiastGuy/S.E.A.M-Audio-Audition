# Writes post-push commit total to _demo/revision.txt (same logic as update-revision.sh).
$ErrorActionPreference = "Stop"
$root = git rev-parse --show-toplevel
if (-not $root) { throw "Not a git repository." }
$out = Join-Path $root "_demo\revision.txt"

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

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($out, "$revision`n", $utf8NoBom)
Write-Host "Wrote revision $revision to _demo/revision.txt"
