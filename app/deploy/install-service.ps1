# Install AlphaCore as a Windows service.
#
#   powershell -ExecutionPolicy Bypass -File deploy\install-service.ps1
#
# Windows has no native equivalent of systemd's drain-on-stop, so this uses the
# Task Scheduler with a start-on-boot trigger and leaves stopping to a script
# that sends the process a real interrupt rather than terminating it — because
# TerminateProcess is SIGKILL by another name, and the point of draining is to
# not be killed mid-run.
param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [int]$Port = 8484,
  [string]$TaskName = 'AlphaCore'
)

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error 'Node.js is not on PATH. Install Node 22.5 or newer.'; exit 1 }

$version = (& $node -v) -replace 'v',''
$major = [int]($version.Split('.')[0])
$minor = [int]($version.Split('.')[1])
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 5)) {
  Write-Error "Node $version found; node:sqlite needs 22.5 or newer."; exit 1
}

Write-Host "  root: $Root"
Write-Host "  node: $node ($version)"

$action  = New-ScheduledTaskAction -Execute $node `
             -Argument '--experimental-sqlite src\server.js' -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtStartup
# RestartCount/Interval is the closest Windows offers to Restart=always.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries -StartWhenAvailable `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -RunLevel Highest -Force | Out-Null

Write-Host ""
Write-Host "  Registered as the scheduled task '$TaskName'."
Write-Host "  Start:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Stop:   powershell -File deploy\stop-service.ps1     (drains first)"
Write-Host "  Logs:   the console window, or redirect ExecStart output"
Write-Host ""
Write-Host "  http://localhost:$Port"
