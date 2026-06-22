# Full backup = DB dump + media archive together, in one timestamped folder under
# D:\cms-backups\weekly-full\full_<timestamp>\ . Reuses backup-db.ps1 + backup-media.ps1.
param([string]$Root = "D:\cms-backups\weekly-full")
$ErrorActionPreference = "Stop"

$ts  = Get-Date -Format "yyyyMMdd_HHmmss"
$dir = Join-Path $Root "full_$ts"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

& "$PSScriptRoot\backup-db.ps1"    -OutDir $dir
& "$PSScriptRoot\backup-media.ps1" -OutDir $dir

Write-Host "Full backup -> $dir"
