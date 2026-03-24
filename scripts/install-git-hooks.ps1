# Copy versioned hooks into .git/hooks (Windows PowerShell).
$root = git rev-parse --show-toplevel
if (-not $root) { throw "Run from inside the git repo." }
foreach ($hook in @('pre-push', 'post-commit', 'post-merge')) {
  $src = Join-Path $root "scripts\git-hooks\$hook"
  $dst = Join-Path $root ".git\hooks\$hook"
  Copy-Item $src $dst -Force
  Write-Host "Installed $dst"
}
Write-Host "pre-push: update-revision push; post-commit / post-merge: update-revision head (Git Bash sh)."
