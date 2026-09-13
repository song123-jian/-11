[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$InstallerPath,
    [string]$InstallerScriptPath,
    [string]$ReleaseBaselinePath,
    [string]$IdleBaselinePath,
    [string]$SessionBaselinePath,
    [string]$SupplyChainManifestPath,
    [ValidateRange(1, 100)]
    [int]$MinimumReleaseSamples = 20,
    [ValidateRange(1, 60)]
    [int]$RequiredIdleMinutes = 10,
    [ValidateRange(1, 10000)]
    [int]$RequiredSessionSamples = 200,
    [ValidateRange(1, 60000)]
    [int]$MaximumStartupP95Milliseconds = 1500,
    [ValidateRange(1, 4096)]
    [int]$MaximumAppWorkingSetP95MiB = 80,
    [string]$UpdateSignaturePath = $env:EFFICIENCY_UPDATE_SIGNATURE_PATH,
    [string]$UpdatePublicKeyPath = $env:EFFICIENCY_UPDATE_PUBLIC_KEY_PATH,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))

function Resolve-ExistingFile([string]$Path, [string]$Label) {
    if (-not $Path) { throw "$Label path is empty" }
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved -or -not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
        throw "$Label not found: $Path"
    }
    return $resolved.Path
}

function Read-JsonFile([string]$Path, [string]$Label) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "$Label is not valid JSON: $Path ($($_.Exception.Message))"
    }
}

function Get-ArtifactSignature([string]$Path) {
    try { return (Get-AuthenticodeSignature -LiteralPath $Path).Status.ToString() } catch { return 'Unavailable' }
}

function Get-ManifestArtifact([object]$Manifest, [string]$RelativePath) {
    return @($Manifest.artifacts | Where-Object { $_.path -eq $RelativePath }) | Select-Object -First 1
}

function Get-BaselineExeHash([object]$Baseline) {
    $hash = [string]$Baseline.artifacts.exeSha256
    if ([string]::IsNullOrWhiteSpace($hash)) { return '' }
    return $hash.Trim().ToUpperInvariant()
}

function Test-DetachedUpdateSignature([string]$ManifestPath, [string]$SignaturePath, [string]$PublicKeyPath) {
    if (-not $PublicKeyPath) {
        return [pscustomobject]@{ passed = $false; detail = 'public-key-not-configured' }
    }
    $signature = Resolve-Path -LiteralPath $SignaturePath -ErrorAction SilentlyContinue
    $publicKey = Resolve-Path -LiteralPath $PublicKeyPath -ErrorAction SilentlyContinue
    if (-not $signature -or -not (Test-Path -LiteralPath $signature.Path -PathType Leaf)) {
        return [pscustomobject]@{ passed = $false; detail = 'signature-file-not-found' }
    }
    if (-not $publicKey -or -not (Test-Path -LiteralPath $publicKey.Path -PathType Leaf)) {
        return [pscustomobject]@{ passed = $false; detail = 'public-key-file-not-found' }
    }
    $verifier = Join-Path $projectRoot 'tools\verify_update_manifest.mjs'
    if (-not (Test-Path -LiteralPath $verifier -PathType Leaf)) {
        return [pscustomobject]@{ passed = $false; detail = 'verifier-not-found' }
    }
    try {
        $null = & node $verifier --manifest $ManifestPath --signature $signature.Path --public-key $publicKey.Path 2>&1
        if ($LASTEXITCODE -eq 0) {
            return [pscustomobject]@{ passed = $true; detail = 'verified-by-tools/verify_update_manifest.mjs' }
        }
    } catch {
        # The gate reports a stable failure reason; verifier details stay out of the release report.
    }
    return [pscustomobject]@{ passed = $false; detail = 'detached-signature-verification-failed' }
}

function Add-Check([System.Collections.Generic.List[object]]$Checks, [string]$Name, [bool]$Passed, [string]$Detail) {
    $Checks.Add([pscustomobject][ordered]@{
        name = $Name
        passed = $Passed
        detail = $Detail
    })
}

function Get-RelativeProjectPath([string]$Path) {
    $baseUri = [Uri]::new($projectRoot.TrimEnd('\') + '\')
    $targetUri = [Uri]::new([IO.Path]::GetFullPath($Path))
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('/', '/')
}

function Get-DefaultInstallerPath() {
    $tauriConfigPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
    if (-not (Test-Path -LiteralPath $tauriConfigPath -PathType Leaf)) {
        throw "Tauri configuration not found: $tauriConfigPath"
    }
    $tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $installerName = '{0}_{1}_x64-setup.exe' -f [string]$tauriConfig.productName, [string]$tauriConfig.version
    return Join-Path $projectRoot "src-tauri\target\release\bundle\nsis\$installerName"
}

if (-not $ExePath) { $ExePath = Join-Path $projectRoot 'src-tauri\target\release\efficiency_toolbox.exe' }
if (-not $InstallerPath) { $InstallerPath = Get-DefaultInstallerPath }
if (-not $InstallerScriptPath) { $InstallerScriptPath = Join-Path $projectRoot 'src-tauri\target\release\nsis\x64\installer.nsi' }
if (-not $ReleaseBaselinePath) { $ReleaseBaselinePath = Join-Path $projectRoot 'output\performance\release-baseline.json' }
if (-not $IdleBaselinePath) { $IdleBaselinePath = Join-Path $projectRoot 'output\performance\idle-baseline.json' }
if (-not $SessionBaselinePath) { $SessionBaselinePath = Join-Path $projectRoot 'output\performance\session-stability-baseline.json' }
if (-not $SupplyChainManifestPath) { $SupplyChainManifestPath = Join-Path $projectRoot 'output\performance\supply-chain-manifest.json' }
if (-not $OutputPath) { $OutputPath = Join-Path $projectRoot 'output\performance\release-gate-report.json' }

$exe = Resolve-ExistingFile $ExePath 'Release EXE'
$installer = Resolve-ExistingFile $InstallerPath 'NSIS installer'
$installerScript = Resolve-ExistingFile $InstallerScriptPath 'NSIS script'
$releasePath = Resolve-ExistingFile $ReleaseBaselinePath 'Release baseline'
$idlePath = Resolve-ExistingFile $IdleBaselinePath 'Idle baseline'
$sessionPath = Resolve-ExistingFile $SessionBaselinePath 'Session stability baseline'
$manifestPath = Resolve-ExistingFile $SupplyChainManifestPath 'Supply-chain manifest'
if (-not $UpdateSignaturePath) {
    $manifestDirectory = Split-Path -Parent $manifestPath
    $manifestStem = [IO.Path]::GetFileNameWithoutExtension($manifestPath)
    $UpdateSignaturePath = Join-Path $manifestDirectory "$manifestStem.sig"
}

$release = Read-JsonFile $releasePath 'Release baseline'
$idle = Read-JsonFile $idlePath 'Idle baseline'
$session = Read-JsonFile $sessionPath 'Session stability baseline'
$manifest = Read-JsonFile $manifestPath 'Supply-chain manifest'
$checks = [System.Collections.Generic.List[object]]::new()

$releaseSummary = $release.summary
$releaseReady = $null -ne $releaseSummary -and [int]$releaseSummary.successfulSamples -ge $MinimumReleaseSamples -and [int]$releaseSummary.failedSamples -eq 0
Add-Check $checks 'release-startup-samples' $releaseReady ("successful={0}, failed={1}, required={2}" -f $releaseSummary.successfulSamples, $releaseSummary.failedSamples, $MinimumReleaseSamples)
$releaseP95Ready = $null -ne $releaseSummary.startupMsP95 -and [double]$releaseSummary.startupMsP95 -le $MaximumStartupP95Milliseconds
Add-Check $checks 'release-startup-p95' $releaseP95Ready ("p95Ms={0}, maximumMs={1}" -f $releaseSummary.startupMsP95, $MaximumStartupP95Milliseconds)
$releaseMemoryReady = $null -ne $releaseSummary.appWorkingSetMiBP95 -and [double]$releaseSummary.appWorkingSetMiBP95 -le $MaximumAppWorkingSetP95MiB
Add-Check $checks 'release-app-memory-p95' $releaseMemoryReady ("p95MiB={0}, maximumMiB={1}" -f $releaseSummary.appWorkingSetMiBP95, $MaximumAppWorkingSetP95MiB)

$idleSummary = $idle.summary
$idleConfigurationReady = $null -ne $idle.configuration -and [int]$idle.configuration.durationMinutes -eq $RequiredIdleMinutes -and [int]$idle.configuration.sampleIntervalSeconds -eq 60
Add-Check $checks 'idle-sampling-configuration' $idleConfigurationReady ("durationMinutes={0}, intervalSeconds={1}" -f $idle.configuration.durationMinutes, $idle.configuration.sampleIntervalSeconds)
$idleReady = $null -ne $idleSummary -and [int]$idleSummary.successfulSamples -ge $RequiredIdleMinutes -and [int]$idleSummary.failedSamples -eq 0 -and [bool]$idleSummary.crashFree
Add-Check $checks 'idle-stability' $idleReady ("successful={0}, failed={1}, crashFree={2}, required={3}" -f $idleSummary.successfulSamples, $idleSummary.failedSamples, $idleSummary.crashFree, $RequiredIdleMinutes)
$idleMemoryReady = $null -ne $idleSummary.appWorkingSetMiBP95 -and [double]$idleSummary.appWorkingSetMiBP95 -le $MaximumAppWorkingSetP95MiB
Add-Check $checks 'idle-app-memory-p95' $idleMemoryReady ("p95MiB={0}, maximumMiB={1}" -f $idleSummary.appWorkingSetMiBP95, $MaximumAppWorkingSetP95MiB)

$sessionSummary = $session.summary
$sessionReady = $null -ne $sessionSummary -and [int]$sessionSummary.successfulSamples -ge $RequiredSessionSamples -and [int]$sessionSummary.failedSamples -eq 0 -and [double]$sessionSummary.successRate -ge 0.999 -and [bool]$sessionSummary.crashFree
Add-Check $checks 'session-stability' $sessionReady ("successful={0}, failed={1}, successRate={2}, crashFree={3}, required={4}" -f $sessionSummary.successfulSamples, $sessionSummary.failedSamples, $sessionSummary.successRate, $sessionSummary.crashFree, $RequiredSessionSamples)

$exeRelativePath = Get-RelativeProjectPath $exe
$installerRelativePath = Get-RelativeProjectPath $installer
$exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToUpperInvariant()
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToUpperInvariant()
$manifestExe = Get-ManifestArtifact $manifest $exeRelativePath
$manifestInstaller = Get-ManifestArtifact $manifest $installerRelativePath
$hashReady = $null -ne $manifestExe -and $null -ne $manifestInstaller -and $manifestExe.sha256 -eq $exeHash -and $manifestInstaller.sha256 -eq $installerHash
Add-Check $checks 'artifact-hashes' $hashReady ("exe={0}, installer={1}" -f $exeHash, $installerHash)

foreach ($baselineCheck in @(
    [pscustomobject]@{ name = 'release-baseline-artifact'; baseline = $release },
    [pscustomobject]@{ name = 'idle-baseline-artifact'; baseline = $idle },
    [pscustomobject]@{ name = 'session-baseline-artifact'; baseline = $session }
)) {
    $recordedHash = Get-BaselineExeHash $baselineCheck.baseline
    $matchesCurrentExe = -not [string]::IsNullOrWhiteSpace($recordedHash) -and $recordedHash -eq $exeHash
    Add-Check $checks $baselineCheck.name $matchesCurrentExe ("recorded={0}, current={1}" -f $(if ($recordedHash) { $recordedHash } else { 'missing' }), $exeHash)
}

$exeSignature = Get-ArtifactSignature $exe
$installerSignature = Get-ArtifactSignature $installer
$artifactSignaturesReady = $exeSignature -eq 'Valid' -and $installerSignature -eq 'Valid'
Add-Check $checks 'authenticode-signatures' $artifactSignaturesReady ("exe={0}, installer={1}" -f $exeSignature, $installerSignature)
$manifestSigning = $manifest.signing
$detachedSignature = Test-DetachedUpdateSignature $manifestPath $UpdateSignaturePath $UpdatePublicKeyPath
$manifestSigningReady = $null -ne $manifestSigning -and [bool]$manifestSigning.releaseQualified -and $manifestSigning.packageSignatureStatus -eq 'Valid' -and $manifestSigning.updateManifestSignatureStatus -eq 'valid' -and $detachedSignature.passed
Add-Check $checks 'supply-chain-signatures' $manifestSigningReady ("releaseQualified={0}, package={1}, updateManifest={2}, detachedVerifier={3}" -f $manifestSigning.releaseQualified, $manifestSigning.packageSignatureStatus, $manifestSigning.updateManifestSignatureStatus, $detachedSignature.detail)

$installerScriptText = Get-Content -LiteralPath $installerScript -Raw -Encoding UTF8
$requiredInstallerTokens = @(
    'Software\Classes\ccswitch',
    '"URL Protocol"',
    '%1',
    'DeleteRegKey SHCTX "Software\Classes\ccswitch"'
)
$missingInstallerTokens = @($requiredInstallerTokens | Where-Object { -not $installerScriptText.Contains($_) })
$protocolReady = $missingInstallerTokens.Count -eq 0
$protocolDetail = if ($protocolReady) { 'installer.nsi contains protocol registration and uninstall cleanup' } else { 'missing: ' + ($missingInstallerTokens -join ', ') }
Add-Check $checks 'ccswitch-installer-registration' $protocolReady $protocolDetail

$failedChecks = @($checks | Where-Object { -not $_.passed })
$output = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
$report = [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    configuration = [ordered]@{
        minimumReleaseSamples = $MinimumReleaseSamples
        requiredIdleMinutes = $RequiredIdleMinutes
        requiredSessionSamples = $RequiredSessionSamples
        maximumStartupP95Milliseconds = $MaximumStartupP95Milliseconds
        maximumAppWorkingSetP95MiB = $MaximumAppWorkingSetP95MiB
        parallelSamplingNote = 'Each sampler creates and terminates its own process tree. Read-only, build, and unit checks may run in parallel, but CPU/IO contention means parallel data is not an isolated performance P95.'
    }
    inputs = [ordered]@{
        exe = Get-RelativeProjectPath $exe
        installer = Get-RelativeProjectPath $installer
        installerScript = Get-RelativeProjectPath $installerScript
        releaseBaseline = Get-RelativeProjectPath $releasePath
        idleBaseline = Get-RelativeProjectPath $idlePath
        sessionBaseline = Get-RelativeProjectPath $sessionPath
        supplyChainManifest = Get-RelativeProjectPath $manifestPath
    }
    checks = @($checks)
    summary = [ordered]@{
        passedChecks = $checks.Count - $failedChecks.Count
        failedChecks = $failedChecks.Count
        releaseQualified = $failedChecks.Count -eq 0
    }
}
$json = $report | ConvertTo-Json -Depth 8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($output, $json, $utf8NoBom)
Write-Host ($report.summary | ConvertTo-Json -Compress)
Write-Host ("Wrote release gate report: {0}" -f $output)
if ($failedChecks.Count -gt 0) {
    Write-Error ("Release gate failed: {0}" -f (($failedChecks | ForEach-Object { $_.name }) -join ', '))
    exit 1
}
