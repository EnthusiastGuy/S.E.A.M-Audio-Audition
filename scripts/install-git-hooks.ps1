# Copy versioned hooks into .git/hooks (Windows PowerShell).
$root = git rev-parse --show-toplevel
if (-not $root) { throw "Run from inside the git repo." }
$src = Join-Path $root "scripts\git-hooks\pre-push"
$dst = Join-Path $root ".git\hooks\pre-push"
Copy-Item $src $dst -Force
Write-Host "Installed pre-push hook -> $dst"
Write-Host "It runs scripts/update-revision.sh via sh (Git for Windows includes this)."
