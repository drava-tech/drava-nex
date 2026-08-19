# Prunes Docker build cache/dangling images, then shuts down Docker Desktop's
# WSL2 VM and compacts docker_data.vhdx (the WSL2 virtual disk never shrinks on
# its own, even after freeing space inside it - see infra/docker/structure.md
# incident 2026-08-14/2026-08-17). Restarts Docker Desktop + cms-nginx after
# (container recreation invalidates nginx's cached upstream IPs).
# Must run elevated (diskpart requires Administrator) - the scheduled task
# that calls this script is configured with -RunLevel Highest.
param(
    [string]$VhdxPath   = "C:\Users\TWT\AppData\Local\Docker\wsl\disk\docker_data.vhdx",
    [string]$DockerExe  = "C:\Program Files\Docker\Docker\Docker Desktop.exe",
    [string]$ComposeYml = "E:\EC\cms-platform\infra\docker\docker-compose.yml",
    [string]$EnvFile    = "E:\EC\cms-platform\.env.production",
    [string]$LogDir     = "E:\EC\cms-platform-data\logs\shrink-docker"
)
$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$logPath = Join-Path $LogDir "shrink_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
Start-Transcript -Path $logPath | Out-Null

try {
    if (-not (Test-Path $VhdxPath)) { throw "vhdx not found at $VhdxPath" }
    $beforeGB = [math]::Round((Get-Item $VhdxPath).Length / 1GB, 2)
    Write-Host "Before: $beforeGB GB"

    Write-Host "Pruning build cache and dangling images..."
    docker builder prune -f
    docker image prune -f

    Write-Host "Stopping Docker Desktop..."
    Get-Process | Where-Object { $_.ProcessName -match 'docker|com\.docker' } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    wsl --shutdown
    Start-Sleep -Seconds 3

    # Belt-and-suspenders: Docker Desktop sometimes respawns a watchdog process.
    Get-Process | Where-Object { $_.ProcessName -match 'docker|com\.docker' } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    wsl --shutdown
    Start-Sleep -Seconds 2

    Write-Host "Compacting $VhdxPath ..."
    $diskpartScript = @"
select vdisk file="$VhdxPath"
attach vdisk readonly
compact vdisk
detach vdisk
exit
"@
    $diskpartScript | diskpart

    $afterGB = [math]::Round((Get-Item $VhdxPath).Length / 1GB, 2)
    Write-Host "After: $afterGB GB (freed $([math]::Round($beforeGB - $afterGB, 2)) GB)"

    Write-Host "Restarting Docker Desktop..."
    Start-Process $DockerExe

    $ready = $false
    for ($i = 0; $i -lt 24; $i++) {
        Start-Sleep -Seconds 5
        docker ps *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }
    if (-not $ready) { throw "Docker did not become ready within 2 minutes" }
    Write-Host "Docker ready after restart."

    # Containers restart automatically (restart: unless-stopped), but give the
    # compose stack a moment then make sure everything's actually up.
    Start-Sleep -Seconds 10
    docker compose --env-file $EnvFile -f $ComposeYml up -d

    # nginx caches upstream container IPs at load; a restart is required
    # whenever the app containers get recreated (see project_lan_deployment memory).
    docker restart cms-nginx | Out-Null
    Start-Sleep -Seconds 5

    Write-Host "Health check:"
    $health = curl.exe -s -m 10 -H "Host: ec-cms" http://127.0.0.1/health
    Write-Host $health
    if ($health -notmatch '"status":"ok"') { throw "Health check failed after restart: $health" }

    Write-Host "Done."
}
finally {
    Stop-Transcript | Out-Null
}
