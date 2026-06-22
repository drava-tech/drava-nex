# Restores a .sql dump into the Dockerized Postgres (cms-postgres).
# WARNING: this WRITES to the live database. Take a fresh backup first
# (pnpm db:backup). Usage:
#   powershell -ExecutionPolicy Bypass -File infra/scripts/restore-db.ps1 -File "D:\cms-backups\cms_db_YYYYMMDD_HHMMSS.sql"
param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference = "Stop"

if (-not (Test-Path $File)) { throw "File not found: $File" }

docker cp "$File" cms-postgres:/tmp/restore.sql
docker exec cms-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/restore.sql'
docker exec cms-postgres rm -f /tmp/restore.sql

Write-Host "Restored from $File"
