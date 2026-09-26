# ─────────────────────────────────────────────────────────────────────────────
# Move the Postgres data directory off the Windows bind mount
# (E:/EC/cms-platform-data/postgres-data) onto a native Docker volume.
#
# WHY: under Docker Desktop that bind mount is proxied from the WSL2 VM to NTFS
# over 9p/virtiofs. Postgres is the pathological workload for that layer — every
# WAL fsync, every 8 KB buffer write and every seq-scan read crosses the VM
# boundary. It is the single largest contributor to platform-wide slowness, and
# it amplifies every query the app makes.
#
# THIS SCRIPT TAKES THE STACK DOWN. Run it in a maintenance window.
#
# It is written to be safe to abort: nothing is destroyed. The old bind-mount
# directory is left completely untouched, so rollback is a one-line revert of
# the compose file (printed at the end). Verify the app, then delete the old
# directory by hand once you are satisfied — never from here.
#
#   pwsh infra/scripts/migrate-postgres-to-volume.ps1
#   pwsh infra/scripts/migrate-postgres-to-volume.ps1 -DryRun
# ─────────────────────────────────────────────────────────────────────────────
param(
    [string]$BackupDir = "D:\cms-backups\volume-migration",
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"

# docker writes progress and warnings to stderr as a matter of course. With
# ErrorActionPreference=Stop, PowerShell turns any native stderr output into a
# terminating NativeCommandError - which aborted this script between "stack
# down" and "compose switched", the worst possible place to stop. Native
# commands are checked via $LASTEXITCODE instead.
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$composeDir = Join-Path $repoRoot "infra\docker"
$compose    = Join-Path $composeDir "docker-compose.yml"
$oldLine    = "      - E:/EC/cms-platform-data/postgres-data:/var/lib/postgresql/data"
$newLine    = "      - postgres-data:/var/lib/postgresql/data"

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }

if (-not (Test-Path $compose)) { throw "docker-compose.yml not found at $compose" }
$composeText = Get-Content $compose -Raw
if ($composeText -notmatch [regex]::Escape($oldLine)) {
    if ($composeText -match [regex]::Escape($newLine)) {
        Write-Host "Already migrated — compose references the named volume. Nothing to do." -ForegroundColor Yellow
        exit 0
    }
    throw "Could not find the expected bind-mount line in docker-compose.yml. Migrate by hand."
}

# ─── 1. Dump, and prove the dump is real before touching anything ────────────
Step 1 "Dumping the live database"
if ($DryRun) {
    Write-Host "  (dry run) would run infra/scripts/backup-db.ps1 -OutDir $BackupDir"
} else {
    & (Join-Path $PSScriptRoot "backup-db.ps1") -OutDir $BackupDir
    $dump = Get-ChildItem $BackupDir -Filter "cms_db_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $dump) { throw "No dump produced — aborting before any destructive step." }
    # A dump that restores to an empty database is the failure mode that costs
    # you the data, and it is not distinguishable by size alone. Require the
    # schema's own marker tables to be present in the text.
    $head = Get-Content $dump.FullName -TotalCount 4000 | Out-String
    foreach ($marker in @("CREATE TABLE public.screen", "CREATE TABLE public.media_asset")) {
        if ($head -notmatch [regex]::Escape($marker)) {
            throw "Dump at $($dump.FullName) is missing '$marker' — refusing to continue."
        }
    }
    Write-Host "  Verified dump: $($dump.FullName)" -ForegroundColor Green
}

# ─── 2. Record row counts so the restore can be checked, not assumed ─────────
Step 2 "Recording pre-migration row counts"
$countProbe = @'
export PGPASSWORD=$POSTGRES_PASSWORD
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select (select count(*) from screen) || '|' || (select count(*) from media_asset) || '|' || (select count(*) from experience) || '|' || (select count(*) from \"user\")"
'@ -replace "`r`n", "`n"

function Get-RowCounts {
    # Written to a file and executed with `sh <file>`: passing this inline
    # through `docker exec sh -c` mangles the nested quoting, which is exactly
    # how this probe silently returned an empty string before.
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $countProbe)
    docker cp $tmp cms-postgres:/tmp/_counts.sh | Out-Null
    Remove-Item $tmp -Force
    $out = (docker exec cms-postgres sh /tmp/_counts.sh) -join ""
    return $out.Trim()
}

# ─── 3. Stop the stack ───────────────────────────────────────────────────────
Step 3 "Stopping the stack"
if ($DryRun) { Write-Host "  (dry run) would run docker compose --env-file ../../.env down" }
else { Push-Location $composeDir; docker compose --env-file ../../.env down; Pop-Location }

# ─── 4. Repoint compose at a named volume ────────────────────────────────────
Step 4 "Switching docker-compose.yml to the named volume"
$backupCompose = "$compose.pre-volume-migration"
if ($DryRun) {
    Write-Host "  (dry run) would rewrite the postgres volume line and add a top-level volumes: block"
} else {
    Copy-Item $compose $backupCompose -Force
    $updated = $composeText -replace [regex]::Escape($oldLine), $newLine
    if ($updated -notmatch "(?m)^volumes:") {
        $updated = $updated.TrimEnd() + "`n`n# Native Docker volume for Postgres — see migrate-postgres-to-volume.ps1.`n# Must NOT be a Windows bind mount: 9p/virtiofs makes every fsync brutally slow.`nvolumes:`n  postgres-data:`n"
    } elseif ($updated -notmatch "(?m)^\s+postgres-data:") {
        $updated = $updated -replace "(?m)^volumes:", "volumes:`n  postgres-data:"
    }
    Set-Content $compose $updated -Encoding utf8 -NoNewline
    Write-Host "  Rewrote $compose (previous copy at $backupCompose)" -ForegroundColor Green
}

# ─── 5. Bring Postgres up alone on the empty volume, then restore ────────────
Step 5 "Starting Postgres on the new volume and restoring"
if ($DryRun) {
    Write-Host "  (dry run) would start postgres and restore the dump"
} else {
    Push-Location $composeDir
    docker compose --env-file ../../.env up -d postgres
    # Wait for the healthcheck rather than sleeping a guessed interval.
    $deadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 3
        $state = (docker inspect -f '{{.State.Health.Status}}' cms-postgres 2>$null)
        Write-Host "  postgres health: $state"
    } while ($state -ne "healthy" -and (Get-Date) -lt $deadline)
    if ($state -ne "healthy") { Pop-Location; throw "Postgres did not become healthy. Compose backup: $backupCompose" }
    Pop-Location

    docker cp $dump.FullName cms-postgres:/tmp/restore.sql
    docker exec cms-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/restore.sql'
    docker exec cms-postgres rm -f /tmp/restore.sql
}

# ─── 6. Verify the restore actually landed ───────────────────────────────────
Step 6 "Verifying row counts match"
if ($DryRun) {
    Write-Host "  (dry run) would compare row counts"
} else {
    $after = Get-RowCounts
    Write-Host "  Before: $before"
    Write-Host "  After:  $after"
    if ($before.Trim() -ne $after.Trim()) {
        throw "ROW COUNTS DIFFER. Do not delete the old data directory. Roll back with: Copy-Item '$backupCompose' '$compose' -Force; docker compose -f '$compose' up -d"
    }
    Write-Host "  Row counts match." -ForegroundColor Green
}

# ─── 7. Bring the rest of the stack back ─────────────────────────────────────
Step 7 "Starting the full stack"
if ($DryRun) { Write-Host "  (dry run) would run docker compose --env-file ../../.env up -d" }
else { Push-Location $composeDir; docker compose --env-file ../../.env up -d; Pop-Location }

Write-Host @"

Done.

The old data directory is UNTOUCHED at E:\EC\cms-platform-data\postgres-data.
Leave it there until you have used the platform for a few days.

Roll back at any point with:
    Copy-Item '$backupCompose' '$compose' -Force
    docker compose -f '$compose' up -d

"@ -ForegroundColor Green
