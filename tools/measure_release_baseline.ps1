[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$InstallerPath,
    [ValidateRange(1, 100)]
    [int]$Samples = 20,
    [ValidateRange(1, 60)]
    [int]$WindowTimeoutSeconds = 10,
    [ValidateRange(0, 60000)]
    [int]$ReadyWaitMilliseconds = 750,
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
if (-not $OutputPath) { $OutputPath = Join-Path $scriptRoot '..\output\performance\release-baseline.json' }

function Resolve-ExistingFile([string]$Path, [string]$Label) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved) {
        throw "$Label not found: $Path"
    }
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
            if ($ids.Add([int]$process.ProcessId)) {
                $queue.Enqueue([int]$process.ProcessId)
            }
        }
    }
    return @($ids)
}

function Get-WorkingSetBytes([int[]]$ProcessIds) {
    $total = [int64]0
    foreach ($processId in $ProcessIds) {
        try {
            $total += (Get-Process -Id $processId -ErrorAction Stop).WorkingSet64
        } catch {
            # A short-lived child can exit between enumeration and sampling.
        }
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
for ($index = 1; $index -le $Samples; $index++) {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $process = $null
    $sample = [ordered]@{ sample = $index; status = 'failed' }
    try {
        $process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
        $ready = $false
        while ($stopwatch.Elapsed.TotalSeconds -lt $WindowTimeoutSeconds) {
            $current = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
            if (-not $current -or $current.HasExited) { break }
            if ($current.MainWindowHandle -ne 0) {
                $ready = $true
                break
            }
            Start-Sleep -Milliseconds 50
        }
        $stopwatch.Stop()
        if (-not $ready) {
            $sample.error = 'main window did not become ready before timeout'
        } else {
            if ($ReadyWaitMilliseconds -gt 0) { Start-Sleep -Milliseconds $ReadyWaitMilliseconds }
            $treeIds = @(Get-DescendantProcessIds $process.Id)
            $sample.status = 'success'
            $sample.startupMs = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
            $sample.appWorkingSetBytes = Get-WorkingSetBytes @($process.Id)
            $sample.treeWorkingSetBytes = Get-WorkingSetBytes $treeIds
            $sample.processCount = $treeIds.Count
        }
    } catch {
        $stopwatch.Stop()
        $sample.error = $_.Exception.Message
        if ($process) { $sample.processId = $process.Id }
    } finally {
        if ($process) { Stop-ProcessTree $process.Id }
    }
    $samplesOutput.Add([pscustomobject]$sample)
    Write-Host ("[{0}/{1}] {2}" -f $index, $Samples, ($sample.status))
}

$successful = @($samplesOutput | Where-Object status -eq 'success')
$startup = @($successful | ForEach-Object { [double]$_.startupMs })
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
        requestedSamples = $Samples
        readyWaitMilliseconds = $ReadyWaitMilliseconds
        windowTimeoutSeconds = $WindowTimeoutSeconds
    }
    summary = [ordered]@{
        successfulSamples = $successful.Count
        failedSamples = $Samples - $successful.Count
        startupMsP50 = Get-Percentile $startup 0.50
        startupMsP95 = Get-Percentile $startup 0.95
        appWorkingSetMiBP50 = Get-Percentile $appMemory 0.50
        appWorkingSetMiBP95 = Get-Percentile $appMemory 0.95
        processTreeWorkingSetMiBP50 = Get-Percentile $treeMemory 0.50
        processTreeWorkingSetMiBP95 = Get-Percentile $treeMemory 0.95
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
Write-Host ("Wrote baseline: {0}" -f $output)
Write-Host ($result.summary | ConvertTo-Json -Compress)
$samplingMutex.ReleaseMutex()
$samplingMutex.Dispose()
