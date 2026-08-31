<#
.SYNOPSIS
  Publishes MainScreenKiosk (+ the frame-unlock-extension folder it needs
  alongside it) and deploys it to a kiosk PC over the LAN.

.DESCRIPTION
  1. dotnet publish (unless -SkipPublish).
  2. Best-effort: stop the remote MainScreenKiosk.exe process over PowerShell
     Remoting, so the copy below isn't blocked by a locked exe.
  3. robocopy /MIR the publish output to an admin share on the target
     (\\ComputerName\C$\...), so the destination folder always ends up an
     exact mirror, including the frame-unlock-extension subfolder.
  4. Best-effort: relaunch MainScreenKiosk.exe remotely.

  Steps 2 and 4 need PowerShell Remoting (WinRM) enabled on the kiosk PC and
  fail gracefully (a warning, not a hard stop) if it isn't - the copy in step
  3 still completes either way. If remoting isn't set up, relaunch the app by
  hand on that PC afterwards (or reboot it, since it auto-starts from the
  Startup folder - see README.md).

.PARAMETER ComputerName
  Hostname or IP of the kiosk PC.

.PARAMETER RemotePath
  Destination folder on the kiosk PC, e.g. 'C:\MainScreenKiosk'. Must be on
  a drive reachable via its admin share (C$, D$, ...) from this machine.

.PARAMETER Credential
  Optional credential for the remote machine, if it differs from the account
  this session is already running as.

.PARAMETER SkipPublish
  Skip the dotnet publish step and deploy whatever is already sitting in
  bin\Release\net8.0-windows\win-x64\publish.

.PARAMETER SkipRestart
  Copy files only - don't attempt to stop/relaunch the app remotely.

.EXAMPLE
  ./deploy.ps1 -ComputerName 192.168.1.55 -RemotePath 'C:\MainScreenKiosk'

.EXAMPLE
  ./deploy.ps1 -ComputerName tv-lobby -RemotePath 'C:\MainScreenKiosk' -Credential (Get-Credential) -SkipPublish
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ComputerName,

    [Parameter(Mandatory)]
    [string]$RemotePath,

    [System.Management.Automation.PSCredential]$Credential,

    [switch]$SkipPublish,
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$publishDir = Join-Path $root 'bin\Release\net8.0-windows\win-x64\publish'

if (-not $SkipPublish) {
    Write-Host "Publishing MainScreenKiosk..." -ForegroundColor Cyan
    Push-Location $root
    try {
        dotnet publish -c Release -r win-x64 --self-contained true `
            -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
        if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $publishDir 'MainScreenKiosk.exe'))) {
    throw "Publish output not found at $publishDir - run without -SkipPublish, or check the build first."
}
if (-not (Test-Path (Join-Path $publishDir 'frame-unlock-extension\manifest.json'))) {
    Write-Warning "frame-unlock-extension\manifest.json is missing from the publish output - the kiosk will still start, but won't be able to auto-load the Frame Unlock extension."
}

$remoteParams = @{ ComputerName = $ComputerName; ErrorAction = 'Stop' }
if ($Credential) { $remoteParams.Credential = $Credential }

if (-not $SkipRestart) {
    Write-Host "Stopping MainScreenKiosk.exe on $ComputerName (if running) and clearing its old WebView2 profile..." -ForegroundColor Cyan
    try {
        Invoke-Command @remoteParams -ScriptBlock {
            param($remotePath)
            Get-Process -Name 'MainScreenKiosk' -ErrorAction SilentlyContinue | Stop-Process -Force
            # A profile created before browser-extension support was added to
            # this app doesn't pick it up just by upgrading the exe - confirmed
            # on the dev machine, where AddBrowserExtensionAsync kept failing
            # with ERROR_NOT_SUPPORTED until this folder was deleted so a fresh
            # profile got created. Deleting it here guarantees the target's
            # first run under the new build starts clean.
            Remove-Item -Path (Join-Path $remotePath 'MainScreenKiosk.exe.WebView2') -Recurse -Force -ErrorAction SilentlyContinue
        } -ArgumentList $RemotePath
    } catch {
        Write-Warning "Couldn't reach $ComputerName over PowerShell Remoting (WinRM) to stop the running app / clear its old profile: $($_.Exception.Message)`nIf MainScreenKiosk.exe is currently running there, the copy below may fail to overwrite the exe - close it by hand on that PC first, then re-run this script. If Frame Unlock still doesn't load after deploying, also manually delete '$RemotePath\MainScreenKiosk.exe.WebView2' on that PC and relaunch."
    }
}

$driveLetter = $RemotePath.Substring(0, 1)
$destUnc = "\\$ComputerName\$driveLetter`$" + $RemotePath.Substring(2)
Write-Host "Copying publish output to $destUnc ..." -ForegroundColor Cyan

$tempDrive = $null
if ($Credential) {
    # Lets robocopy/Test-Path authenticate against the UNC path under
    # different credentials than the current session is running as.
    $tempDrive = New-PSDrive -Name KioskDeploy -PSProvider FileSystem -Root "\\$ComputerName\$driveLetter`$" -Credential $Credential
}

try {
    # /XD excludes this machine's own local WebView2 profile (cache, cookies,
    # whatever extension state came from testing here) from ever being shipped
    # to the target - it's per-machine runtime state, not a build artifact.
    robocopy $publishDir $destUnc /MIR /XD (Join-Path $publishDir 'MainScreenKiosk.exe.WebView2') /R:2 /W:2 /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit code $LASTEXITCODE) copying to $destUnc" }
} finally {
    if ($tempDrive) { Remove-PSDrive -Name KioskDeploy -ErrorAction SilentlyContinue }
}

if (-not $SkipRestart) {
    Write-Host "Relaunching MainScreenKiosk.exe on $ComputerName..." -ForegroundColor Cyan
    try {
        Invoke-Command @remoteParams -ScriptBlock {
            param($exePath)
            Start-Process -FilePath $exePath
        } -ArgumentList (Join-Path $RemotePath 'MainScreenKiosk.exe')
        Write-Host "Deployed and relaunched." -ForegroundColor Green
    } catch {
        Write-Warning "Copied the files, but couldn't relaunch it remotely: $($_.Exception.Message)`nStart MainScreenKiosk.exe by hand on that PC, or reboot it (it auto-starts from the Startup folder)."
    }
} else {
    Write-Host "Copied. Relaunch MainScreenKiosk.exe on $ComputerName by hand (or reboot it)." -ForegroundColor Green
}
