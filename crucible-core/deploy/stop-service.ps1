# Stop AlphaCore the way it expects to be stopped.
#
# Stop-ScheduledTask calls TerminateProcess, which is SIGKILL by another name:
# whatever was mid-run is abandoned and only found at the next boot. This sends
# a real Ctrl+C to the process's console instead, so the drain runs.
param([int]$Port = 8484, [int]$WaitSeconds = 60)

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { Write-Host "  nothing is listening on $Port"; exit 0 }
$processId = $conn.OwningProcess
Write-Host "  asking process $processId to drain…"

# Attach to its console and raise Ctrl+C there.
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleCtrl {
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint p);
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool add);
  [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue

[ConsoleCtrl]::FreeConsole() | Out-Null
if ([ConsoleCtrl]::AttachConsole([uint32]$processId)) {
  [ConsoleCtrl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
  [ConsoleCtrl]::GenerateConsoleCtrlEvent(0, 0) | Out-Null
  [ConsoleCtrl]::FreeConsole() | Out-Null
} else {
  Write-Warning '  could not attach to its console; falling back to Stop-Process, which does not drain'
  Stop-Process -Id $processId -Force
  exit 0
}

for ($i = 0; $i -lt $WaitSeconds; $i++) {
  Start-Sleep -Seconds 1
  if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
    Write-Host "  stopped cleanly after $i second(s)"
    exit 0
  }
}
Write-Warning "  still running after $WaitSeconds seconds; killing it"
Stop-Process -Id $processId -Force
