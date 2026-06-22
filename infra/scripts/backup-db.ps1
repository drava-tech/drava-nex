# Backs up the Dockerized Postgres (cms-postgres) to a timestamped .sql in $OutDir.
# Read-only: pg_dump never modifies the database. Default target: D:\cms-backups
param([string]$OutDir = "D:\cms-backups")
$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$ts   = Get-Date -Format "yyyyMMdd_HHmmss"
$dest = Join-Path $OutDir "cms_db_$ts.sql"

# Dump inside the container (correct UTF-8, no BOM), then copy the file out.
docker exec cms-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists -f /tmp/cms_db.sql'
docker cp cms-postgres:/tmp/cms_db.sql "$dest"
docker exec cms-postgres rm -f /tmp/cms_db.sql

if (-not (Test-Path $dest) -or (Get-Item $dest).Length -eq 0) { throw "Backup failed or empty: $dest" }
Write-Host "Backup written to $dest ($([math]::Round((Get-Item $dest).Length/1KB,1)) KB)"
