[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
if (-not $ExePath) { $ExePath = Join-Path $projectRoot 'src-tauri\target\release\efficiency_toolbox.exe' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'output\portable' }

function Resolve-ExistingFile([string]$Path, [string]$Label) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved -or -not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
        throw "$Label not found: $Path"
    }
    return $resolved.Path
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

$exe = Resolve-ExistingFile $ExePath 'Release EXE'
$configPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = [string]$config.productName
$version = [string]$config.version
$packageName = "${productName}_${version}_x64-portable"
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$staging = Join-Path $outputRoot $packageName
$zipPath = Join-Path $outputRoot "$packageName.zip"

if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $staging 'data') | Out-Null
Copy-Item -LiteralPath $exe -Destination (Join-Path $staging 'efficiency_toolbox.exe')
New-Item -ItemType File -Force -Path (Join-Path $staging 'portable.flag') | Out-Null

$readme = @"
$productName portable package

Run efficiency_toolbox.exe directly. The portable.flag file makes WebView2 data live in the data folder.
This package does not install services, registry startup entries, or a WebView2 runtime.
Windows 10/11 with a compatible WebView2 Runtime is required.
Keep the data folder with the executable when moving the package to another drive.
Diagnostic logs are local only and are not uploaded automatically.
"@
Write-Utf8NoBom (Join-Path $staging 'README-portable.txt') $readme.TrimStart()

$exeHash = (Get-FileHash -LiteralPath (Join-Path $staging 'efficiency_toolbox.exe') -Algorithm SHA256).Hash.ToUpperInvariant()
$manifest = [ordered]@{
    schemaVersion = 1
    productName = $productName
    version = $version
    package = $packageName
    executable = 'efficiency_toolbox.exe'
    sha256 = $exeHash
    dataMode = 'portable.flag -> .\data\webview'
    requires = @('Windows 10/11', 'WebView2 Runtime')
    administratorRequired = $false
    registryWrites = $false
}
Write-Utf8NoBom (Join-Path $staging 'portable-manifest.json') ($manifest | ConvertTo-Json -Depth 6)
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ("Wrote portable package: {0}" -f $zipPath)
Write-Host (($manifest | ConvertTo-Json -Compress))
