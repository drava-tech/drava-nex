# Backs up the uploaded media (UPLOAD_DIR) to a timestamped .zip in $OutDir.
# Source defaults to UPLOAD_DIR from the root .env. Default target: D:\cms-backups\media
param(
  [string]$OutDir = "D:\cms-backups\media",
  [string]$Source
)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
if (-not $Source) {
  $line   = Select-String -Path (Join-Path $repo ".env") -Pattern '^UPLOAD_DIR=(.+)$' | Select-Object -First 1
  $Source = if ($line) { $line.Matches.Groups[1].Value.Trim() } else { "E:\EC\cms-platform-data\uploads" }
}
if (-not (Test-Path $Source)) { throw "Media source not found: $Source" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$ts    = Get-Date -Format "yyyyMMdd_HHmmss"
$dest  = Join-Path $OutDir "media_$ts.zip"
$count = (Get-ChildItem $Source -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count

if ($count -eq 0) {
  Write-Host "No media files in $Source - nothing to back up (skipped)."
  return
}
Compress-Archive -Path (Join-Path $Source '*') -DestinationPath $dest -Force
Write-Host "Media backup ($count files) -> $dest ($([math]::Round((Get-Item $dest).Length/1KB,1)) KB)"
