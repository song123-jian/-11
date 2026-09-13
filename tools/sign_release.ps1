[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$InstallerPath,
    [string]$CertificateThumbprint = $env:EFFICIENCY_CODE_SIGN_CERTIFICATE_THUMBPRINT,
    [string]$TimestampServer = $env:EFFICIENCY_TIMESTAMP_SERVER
)

$ErrorActionPreference = 'Stop'
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
if (-not $ExePath) { $ExePath = Join-Path $projectRoot 'src-tauri\target\release\efficiency_toolbox.exe' }

function Resolve-ExistingFile([string]$Path, [string]$Label) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved -or -not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
        throw "$Label not found: $Path"
    }
    return $resolved.Path
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

if (-not $InstallerPath) { $InstallerPath = Get-DefaultInstallerPath }
$exe = Resolve-ExistingFile $ExePath 'Release EXE'
$installer = Resolve-ExistingFile $InstallerPath 'NSIS installer'
$thumbprint = ($CertificateThumbprint -replace '\s', '').ToUpperInvariant()
if (-not $thumbprint) {
    throw 'EFFICIENCY_CODE_SIGN_CERTIFICATE_THUMBPRINT is required; refusing unsigned signing'
}
if (-not $TimestampServer) {
    throw 'EFFICIENCY_TIMESTAMP_SERVER is required; refusing signing without a timestamp'
}
try {
    $timestampUri = [Uri]$TimestampServer
    if ($timestampUri.Scheme -notin @('http', 'https')) { throw 'timestamp scheme must be http or https' }
} catch {
    throw "EFFICIENCY_TIMESTAMP_SERVER is not a valid HTTP(S) URL: $TimestampServer"
}

$certificate = @(Get-ChildItem -Path 'Cert:\CurrentUser\My' | Where-Object { $_.Thumbprint -eq $thumbprint }) | Select-Object -First 1
if (-not $certificate) { throw "Code-signing certificate was not found in CurrentUser\\My: $thumbprint" }
if (-not $certificate.HasPrivateKey) { throw 'Code-signing certificate has no private key; refusing to continue' }
$codeSigningOid = '1.3.6.1.5.5.7.3.3'
$hasCodeSigningEku = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq $codeSigningOid }).Count -gt 0
if (-not $hasCodeSigningEku) { throw 'Certificate lacks code-signing EKU (1.3.6.1.5.5.7.3.3); refusing to continue' }

foreach ($artifact in @($exe, $installer)) {
    $result = Set-AuthenticodeSignature -LiteralPath $artifact -Certificate $certificate -TimestampServer $TimestampServer
    $status = $result.Status.ToString()
    Write-Host ("Signed {0}: {1}" -f $artifact, $status)
    if ($status -ne 'Valid') { throw "Authenticode signing failed for ${artifact}: $status" }
}

Push-Location $projectRoot
try {
    & node tools/build_supply_chain_manifest.mjs
    if ($LASTEXITCODE -ne 0) { throw "Supply-chain manifest rebuild failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host 'Release artifacts signed and supply-chain manifest regenerated.'
