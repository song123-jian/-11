[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$InstallerPath,
    [ValidateRange(1, 60)]
    [int]$DurationMinutes = 10,
    [ValidateRange(60, 600)]
    [int]$SampleIntervalSeconds = 60,
    [ValidateRange(1, 60)]
    [int]$WindowTimeoutSeconds = 10,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$samplingMutex = [System.Threading.Mutex]::new($false, 'Local\EfficiencyToolboxReleaseSampling')
try {
    $samplingMutexAcquired = $samplingMutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    $samplingMutexAcquired = $true
}
if (-not $samplingMutexAcquired) {
    $samplingMutex.Dispose()
    throw 'another Release EXE sampling script is already running; wait for it to finish before retrying'
}
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not $ExePath) { $ExePath = Join-Path $scriptRoot '..\src-tauri\target\release\efficiency_toolbox.exe' }
if (-not $InstallerPath) {
    $tauriConfigPath = Join-Path $scriptRoot '..\src-tauri\tauri.conf.json'
    if (-not (Test-Path -LiteralPath $tauriConfigPath -PathType Leaf)) {
        throw "Tauri configuration not found: $tauriConfigPath"
    }
    $tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $installerName = '{0}_{1}_x64-setup.exe' -f [string]$tauriConfig.productName, [string]$tauriConfig.version
    $InstallerPath = Join-Path $scriptRoot "..\src-tauri\target\release\bundle\nsis\$installerName"
}
if (-not $OutputPath) { $OutputPath = Join-Path $scriptRoot '..\output\performance\idle-baseline.json' }

function Resolve-ExistingFile([string]$Path, [string]$Label) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved) { throw "$Label not found: $Path" }
    return $resolved.Path
}

function Get-DescendantProcessIds([int]$RootPid) {
    $processes = @(Get-CimInstance Win32_Process)
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    $queue = [System.Collections.Generic.Queue[int]]::new()
    [void]$ids.Add($RootPid)
    $queue.Enqueue($RootPid)
    while ($queue.Count -gt 0) {
        $parentPid = $queue.Dequeue()
        foreach ($process in $processes | Where-Object ParentProcessId -eq $parentPid) {
            if ($ids.Add([int]$process.ProcessId)) { $queue.Enqueue([int]$process.ProcessId) }
        }
    }
    return @($ids)
}

function Get-WorkingSetBytes([int[]]$ProcessIds) {
    $total = [int64]0
    foreach ($processId in $ProcessIds) {
        try { $total += (Get-Process -Id $processId -ErrorAction Stop).WorkingSet64 } catch { }
    }
    return $total
}

function Stop-ProcessTree([int]$RootPid) {
    $processIds = @(Get-DescendantProcessIds $RootPid)
    foreach ($processId in $processIds | Sort-Object -Descending) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

function Get-Percentile([double[]]$Values, [double]$Percent) {
    if (-not $Values.Count) { return $null }
    $sorted = @($Values | Sort-Object)
    $rank = [Math]::Ceiling($sorted.Count * $Percent)
    $index = [Math]::Max(0, [Math]::Min($sorted.Count - 1, $rank - 1))
    return [Math]::Round([double]$sorted[$index], 2)
}

$exe = Resolve-ExistingFile $ExePath 'Release EXE'
$installer = Resolve-ExistingFile $InstallerPath 'NSIS installer'
$output = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $output
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$samplesOutput = [System.Collections.Generic.List[object]]::new()
$process = $null
$startupStopwatch = [Diagnostics.Stopwatch]::StartNew()
$idleStopwatch = $null
$startupReady = $false
try {
    $process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
    $ready = $false
    while ($startupStopwatch.Elapsed.TotalSeconds -lt $WindowTimeoutSeconds) {
        $current = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
        if (-not $current -or $current.HasExited) { break }
        if ($current.MainWindowHandle -ne 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 50
    }
    $startupStopwatch.Stop()
    if (-not $ready) { throw 'main window did not become ready before timeout' }
    $startupReady = $true

    $idleStopwatch = [Diagnostics.Stopwatch]::StartNew()
    for ($minute = 1; $minute -le $DurationMinutes; $minute++) {
        $targetSeconds = $minute * $SampleIntervalSeconds
        while ($idleStopwatch.Elapsed.TotalSeconds -lt $targetSeconds) {
            $current = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
            if (-not $current -or $current.HasExited) { throw "process exited before minute $minute sample" }
            $remaining = $targetSeconds - $idleStopwatch.Elapsed.TotalSeconds
            Start-Sleep -Milliseconds ([Math]::Min(500, [Math]::Max(50, [int]($remaining * 1000))))
        }
        $treeIds = @(Get-DescendantProcessIds $process.Id)
        $sample = [ordered]@{
            minute = $minute
            status = 'success'
            elapsedSeconds = [Math]::Round($idleStopwatch.Elapsed.TotalSeconds, 2)
            appWorkingSetBytes = Get-WorkingSetBytes @($process.Id)
            treeWorkingSetBytes = Get-WorkingSetBytes $treeIds
            processCount = $treeIds.Count
        }
        $samplesOutput.Add([pscustomobject]$sample)
        Write-Host ("[{0}/{1}] success app={2:N2} MiB tree={3:N2} MiB" -f $minute, $DurationMinutes, ($sample.appWorkingSetBytes / 1MB), ($sample.treeWorkingSetBytes / 1MB))
    }
} catch {
    $startupStopwatch.Stop()
    if ($idleStopwatch) { $idleStopwatch.Stop() }
    $samplesOutput.Add([pscustomobject][ordered]@{
        minute = $samplesOutput.Count + 1
        status = 'failed'
        error = $_.Exception.Message
    })
    Write-Host ("idle sampling failed: {0}" -f $_.Exception.Message)
} finally {
    if ($process) { Stop-ProcessTree $process.Id }
}

$successful = @($samplesOutput | Where-Object status -eq 'success')
$appMemory = @($successful | ForEach-Object { [double]$_.appWorkingSetBytes / 1MB })
$treeMemory = @($successful | ForEach-Object { [double]$_.treeWorkingSetBytes / 1MB })
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$result = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    environment = [ordered]@{
        os = $os.ProductName
        osDisplayVersion = $os.DisplayVersion
        osBuild = $os.CurrentBuild
        powershell = $PSVersionTable.PSVersion.ToString()
        exe = $exe
    }
    configuration = [ordered]@{
        durationMinutes = $DurationMinutes
        sampleIntervalSeconds = $SampleIntervalSeconds
        windowTimeoutSeconds = $WindowTimeoutSeconds
    }
    summary = [ordered]@{
        startupReady = $startupReady
        startupMs = [Math]::Round($startupStopwatch.Elapsed.TotalMilliseconds, 2)
        successfulSamples = $successful.Count
        failedSamples = $samplesOutput.Count - $successful.Count
        expectedSamples = $DurationMinutes
        appWorkingSetMiBP50 = Get-Percentile $appMemory 0.50
        appWorkingSetMiBP95 = Get-Percentile $appMemory 0.95
        processTreeWorkingSetMiBP50 = Get-Percentile $treeMemory 0.50
        processTreeWorkingSetMiBP95 = Get-Percentile $treeMemory 0.95
        crashFree = ($successful.Count -eq $DurationMinutes)
    }
    artifacts = [ordered]@{
        exeBytes = (Get-Item -LiteralPath $exe).Length
        exeSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
        installerBytes = (Get-Item -LiteralPath $installer).Length
        installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
        installerSignature = (Get-AuthenticodeSignature -LiteralPath $installer).Status.ToString()
    }
    samples = $samplesOutput
}
$json = $result | ConvertTo-Json -Depth 8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($output, $json, $utf8NoBom)
Write-Host ("Wrote idle baseline: {0}" -f $output)
Write-Host ($result.summary | ConvertTo-Json -Compress)
$samplingMutex.ReleaseMutex()
$samplingMutex.Dispose()
