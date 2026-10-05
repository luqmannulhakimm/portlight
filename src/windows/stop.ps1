param([int]$TargetPid, [string]$Identity, [int]$Port, [ValidateSet('TCP','UDP')][string]$Protocol)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $p = Get-Process -Id $TargetPid -ErrorAction Stop
    # Keep a handle to this process before checking identity; never follow a reused PID.
    $null = $p.Handle
    if ($p.StartTime.ToUniversalTime().Ticks.ToString() -ne $Identity) { throw 'Process changed since the last scan. Refresh and try again.' }
    $processPath = $p.Path
    if ($TargetPid -le 4 -or !$processPath -or $processPath.StartsWith($env:windir + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Windows system processes are protected.' }
    if ($Protocol -eq 'TCP') {
        $endpoints = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $TargetPid })
    } else {
        $endpoints = @(Get-NetUDPEndpoint -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $TargetPid })
    }
    if ($endpoints.Count -eq 0) { throw 'This process no longer owns the selected port. Refresh and try again.' }
    if ($p.HasExited) { throw 'The process has already exited.' }
    $p.Kill()
    if (!$p.WaitForExit(5000)) { throw 'Windows has not confirmed that the process stopped. Refresh to check.' }
    @{ ok = $true } | ConvertTo-Json -Compress
} catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
