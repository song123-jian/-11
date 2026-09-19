[CmdletBinding()]
param(
    [string]$ExePath,
    [ValidateRange(1, 60)]
    [int]$DurationMinutes = 10,
    [ValidateRange(1, 600)]
    [int]$SampleIntervalSeconds = 60,
    [ValidateRange(1, 60)]
    [int]$WindowTimeoutSeconds = 10,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
if (-not $ExePath) { $ExePath = Join-Path $projectRoot 'src-tauri\target\release\efficiency_toolbox.exe' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'output\performance\idle-diagnostics' }

function Resolve-ExistingFile([string]$Path, [string]$Label) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved -or -not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
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
        foreach ($processInfo in $processes | Where-Object ParentProcessId -eq $parentPid) {
            if ($ids.Add([int]$processInfo.ProcessId)) { $queue.Enqueue([int]$processInfo.ProcessId) }
        }
    }
    return @($ids)
}

function Get-ProcessSnapshot([int]$RootPid) {
    $processes = @(Get-CimInstance Win32_Process)
    $ids = Get-DescendantProcessIds $RootPid
    return @($processes | Where-Object { $ids -contains [int]$_.ProcessId } | ForEach-Object {
        $exitCode = $null
        try { $exitCode = (Get-Process -Id ([int]$_.ProcessId) -ErrorAction Stop).ExitCode } catch { }
        $commandLine = [string]$_.CommandLine
        [ordered]@{
            pid = [int]$_.ProcessId
            parentPid = [int]$_.ParentProcessId
            name = [string]$_.Name
            executablePath = [string]$_.ExecutablePath
            # Command lines can contain deep-link query strings or credentials.
            # Keep only presence metadata; the local stderr/panic logs remain the
            # diagnostic source when an argument-level investigation is needed.
            commandLinePresent = -not [string]::IsNullOrWhiteSpace($commandLine)
            exitCode = $exitCode
        }
    })
}

function Stop-ProcessTree([int]$RootPid) {
    foreach ($processId in @(Get-DescendantProcessIds $RootPid) | Sort-Object -Descending) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

function Write-Utf8Json([string]$Path, [object]$Value) {
    $json = $Value | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Get-ApplicationEvents([datetime]$StartTime, [datetime]$EndTime) {
    try {
        return @(
            Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $StartTime; EndTime = $EndTime } -ErrorAction Stop |
                Where-Object { $_.ProviderName -in @('Application Error', 'Windows Error Reporting', '.NET Runtime') -or $_.Id -in @(1000, 1001, 1026) } |
                Select-Object TimeCreated, ProviderName, Id, LevelDisplayName, Message
        )
    } catch {
        return @([ordered]@{ unavailable = $true; error = $_.Exception.Message })
    }
}

$exe = Resolve-ExistingFile $ExePath 'Release EXE'
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$runDirectory = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) $runId
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
$webviewDirectory = Join-Path $runDirectory 'webview-data'
New-Item -ItemType Directory -Force -Path $webviewDirectory | Out-Null
$panicPath = Join-Path $runDirectory 'panic.log'
$stdoutPath = Join-Path $runDirectory 'stdout.log'
$stderrPath = Join-Path $runDirectory 'stderr.log'
$processTreePath = Join-Path $runDirectory 'process-tree.jsonl'
$resultPath = Join-Path $runDirectory 'result.json'
$startTime = Get-Date
$exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToUpperInvariant()
$treeSnapshots = [System.Collections.Generic.List[object]]::new()
$process = $null
$stdout = ''
$stderr = ''
$startupReady = $false
$completedTarget = $false
$unexpectedExit = $false
$exitCode = $null
$failure = $null
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
$targetSeconds = $DurationMinutes * 60

try {
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $exe
    $startInfo.WorkingDirectory = Split-Path -Parent $exe
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables['RUST_BACKTRACE'] = 'full'
    $startInfo.EnvironmentVariables['RUST_LOG'] = 'info'
    $startInfo.EnvironmentVariables['EFFICIENCY_DIAGNOSTIC_RUN_ID'] = $runId
    $startInfo.EnvironmentVariables['EFFICIENCY_DIAGNOSTIC_PANIC_LOG'] = $panicPath
    $startInfo.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $webviewDirectory
    $startInfo.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = "--enable-logging --log-level=0 --log-file=$($runDirectory.Replace('\', '/'))/webview.log"
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'failed to start Release EXE' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $readyWatch = [Diagnostics.Stopwatch]::StartNew()
    while ($readyWatch.Elapsed.TotalSeconds -lt $WindowTimeoutSeconds) {
        $process.Refresh()
        if ($process.HasExited) { break }
        if ($process.MainWindowHandle -ne 0) { $startupReady = $true; break }
        Start-Sleep -Milliseconds 100
    }
    $readyWatch.Stop()
    if (-not $startupReady) { throw 'main window did not become ready before timeout or process exited' }

    $nextSampleAt = $SampleIntervalSeconds
    $sampleIndex = 0
    while ($stopwatch.Elapsed.TotalSeconds -lt $targetSeconds) {
        $process.Refresh()
        $snapshot = [ordered]@{
            at = (Get-Date).ToUniversalTime().ToString('o')
            elapsedSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
            rootAlive = -not $process.HasExited
            processes = @(Get-ProcessSnapshot $process.Id)
        }
        $treeSnapshots.Add([pscustomobject]$snapshot)
        if ($process.HasExited) {
            $unexpectedExit = $true
            $exitCode = $process.ExitCode
            $failure = "root process exited before target at $([Math]::Round($stopwatch.Elapsed.TotalSeconds, 2)) seconds"
            break
        }
        if ($stopwatch.Elapsed.TotalSeconds -ge $nextSampleAt) {
            $sampleIndex += 1
            Write-Host ("sample {0} at {1}s: process alive" -f $sampleIndex, [Math]::Round($stopwatch.Elapsed.TotalSeconds, 1))
            $nextSampleAt += $SampleIntervalSeconds
        }
        Start-Sleep -Milliseconds 1_000
    }
    if (-not $unexpectedExit) { $completedTarget = $true }
} catch {
    $failure = $_.Exception.Message
    if ($process -and $process.HasExited) {
        $unexpectedExit = -not $completedTarget
        $exitCode = $process.ExitCode
    }
} finally {
    $stopwatch.Stop()
    if ($process) {
        if (-not $process.HasExited) { Stop-ProcessTree $process.Id }
        try { $stdout = $stdoutTask.GetAwaiter().GetResult() } catch { }
        try { $stderr = $stderrTask.GetAwaiter().GetResult() } catch { }
        $process.Dispose()
    }
    [IO.File]::WriteAllText($stdoutPath, $stdout, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($stderrPath, $stderr, [Text.UTF8Encoding]::new($false))
    $endTime = Get-Date
    $treeLines = $treeSnapshots | ForEach-Object { $_ | ConvertTo-Json -Depth 8 -Compress }
    [IO.File]::WriteAllLines($processTreePath, $treeLines, [Text.UTF8Encoding]::new($false))
    $events = Get-ApplicationEvents $startTime ($endTime.AddSeconds(5))
    $result = [ordered]@{
        schemaVersion = 1
        runId = $runId
        generatedAt = $endTime.ToUniversalTime().ToString('o')
        environment = [ordered]@{
            os = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').ProductName
            osBuild = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuild
            powershell = $PSVersionTable.PSVersion.ToString()
            exe = $exe
            exeSha256 = $exeHash
        }
        configuration = [ordered]@{
            durationMinutes = $DurationMinutes
            targetSeconds = $targetSeconds
            sampleIntervalSeconds = $SampleIntervalSeconds
            windowTimeoutSeconds = $WindowTimeoutSeconds
            logUpload = 'disabled'
        }
        summary = [ordered]@{
            startupReady = $startupReady
            completedTarget = $completedTarget
            unexpectedExit = $unexpectedExit
            exitCode = $exitCode
            elapsedSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
            crashFree = $completedTarget -and -not $unexpectedExit
            failure = $failure
        }
        artifacts = [ordered]@{
            stdout = (Split-Path -Leaf $stdoutPath)
            stderr = (Split-Path -Leaf $stderrPath)
            panic = (Split-Path -Leaf $panicPath)
            processTree = (Split-Path -Leaf $processTreePath)
            windowsEvents = 'windows-events.json'
            webviewLog = 'webview.log'
        }
        windowsEvents = $events
    }
    Write-Utf8Json $resultPath $result
    Write-Utf8Json (Join-Path $runDirectory 'manifest.json') ([ordered]@{
        runId = $runId
        exeSha256 = $exeHash
        startedAt = $startTime.ToUniversalTime().ToString('o')
        result = (Split-Path -Leaf $resultPath)
        files = @('stdout.log', 'stderr.log', 'panic.log', 'process-tree.jsonl', 'result.json', 'windows-events.json', 'webview.log')
    })
    Write-Utf8Json (Join-Path $runDirectory 'windows-events.json') $events
}

Write-Host ("Wrote diagnostic run: {0}" -f $runDirectory)
Write-Host ((Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json).summary | ConvertTo-Json -Compress)
