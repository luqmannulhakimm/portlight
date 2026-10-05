$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$metadata = @{}
Get-CimInstance Win32_Process | ForEach-Object { $metadata[[int]$_.ProcessId] = $_ }
$items = @(Get-Process | ForEach-Object {
    $p = $_
    $m = $metadata[[int]$p.Id]
    $started = $null
    $identity = $null
    try { $started = $p.StartTime.ToUniversalTime().ToString('o'); $identity = $p.StartTime.ToUniversalTime().Ticks.ToString() } catch {}
    [PSCustomObject]@{
        pid = $p.Id
        name = $p.ProcessName
        path = $m.ExecutablePath
        command = $m.CommandLine
        parentPid = [int]$m.ParentProcessId
        startedAt = $started
        identity = $identity
        memoryBytes = $p.WorkingSet64
    }
})
ConvertTo-Json -InputObject $items -Compress -Depth 3
