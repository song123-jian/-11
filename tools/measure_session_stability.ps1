[CmdletBinding()]
param(
    [string]$ExePath,
    [ValidateRange(1, 10000)]
    [int]$Samples = 200,
    [ValidateRange(1, 60)]
    [int]$WindowTimeoutSeconds = 10,
    [ValidateRange(1, 1000)]
    [int]$ProgressEvery = 20,
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
if (-not $OutputPath) { $OutputPath = Join-Path $scriptRoot '..\output\performance\session-stability-baseline.json' }

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

function Stop-ProcessTree([int]$RootPid) {
    foreach ($processId in @(Get-DescendantProcessIds $RootPid) | Sort-Object -Descending) {
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
$output = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
$samplesOutput = [System.Collections.Generic.List[object]]::new()

for ($index = 1; $index -le $Samples; $index++) {
    $process = $null
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $sample = [ordered]@{ sample = $index; status = 'failed' }
    try {
        $process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
        $ready = $false
        while ($stopwatch.Elapsed.TotalSeconds -lt $WindowTimeoutSeconds) {
            $current = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
            if (-not $current -or $current.HasExited) { break }
            $current.Refresh()
            if ($current.MainWindowHandle -ne 0) {
                $ready = $true
                break
            }
            Start-Sleep -Milliseconds 25
        }
        $stopwatch.Stop()
        if ($ready) {
            $sample.status = 'success'
            $sample.startupMs = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
        } else {
            $sample.error = 'main window did not become ready before timeout or process exited'
            if ($process.HasExited) { $sample.exitCode = $process.ExitCode }
        }
    } catch {
        $stopwatch.Stop()
        $sample.error = $_.Exception.Message
    } finally {
        if ($process) { Stop-ProcessTree $process.Id }
    }
    $samplesOutput.Add([pscustomobject]$sample)
    if ($index -eq 1 -or $index -eq $Samples -or $index % $ProgressEvery -eq 0) {
        Write-Host ("[{0}/{1}] {2}" -f $index, $Samples, $sample.status)
    }
}

$successful = @($samplesOutput | Where-Object status -eq 'success')
$startup = @($successful | ForEach-Object { [double]$_.startupMs })
$successRate = if ($Samples -gt 0) { [Math]::Round($successful.Count / $Samples, 6) } else { 0 }
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
        requestedSamples = $Samples
        targetSamples = 200
        windowTimeoutSeconds = $WindowTimeoutSeconds
        progressEvery = $ProgressEvery
        sessionEnd = 'test harness terminates the process tree after the main window becomes ready'
    }
    summary = [ordered]@{
        successfulSamples = $successful.Count
        failedSamples = $Samples - $successful.Count
        successRate = $successRate
        crashFree = ($successful.Count -eq $Samples)
        releaseGateQualified = ($Samples -ge 200 -and $successRate -ge 0.999)
        startupMsP50 = Get-Percentile $startup 0.50
        startupMsP95 = Get-Percentile $startup 0.95
    }
    artifacts = [ordered]@{
        exeBytes = (Get-Item -LiteralPath $exe).Length
        exeSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    }
    samples = $samplesOutput
}
$json = $result | ConvertTo-Json -Depth 8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($output, $json, $utf8NoBom)
Write-Host ("Wrote session stability baseline: {0}" -f $output)
Write-Host ($result.summary | ConvertTo-Json -Compress)
$samplingMutex.ReleaseMutex()
$samplingMutex.Dispose()
