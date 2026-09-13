[CmdletBinding()]
param(
    [string]$SofficePath,
    [string]$PdfInfoPath,
    [string]$SampleDirectory,
    [string]$OutputDirectory,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not $SofficePath) { $SofficePath = 'soffice.exe' }
if (-not $SampleDirectory) { $SampleDirectory = Join-Path $scriptRoot '..\output\validation\office-samples' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $scriptRoot '..\output\validation\office-pdfs-scripted' }
if (-not $OutputPath) { $OutputPath = Join-Path $scriptRoot '..\output\performance\office-conversion-baseline.json' }

function Resolve-Executable([string]$Path, [string]$Label) {
    $candidate = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($candidate) { return $candidate.Path }
    $command = Get-Command $Path -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "$Label not found: $Path"
}

$soffice = Resolve-Executable $SofficePath 'LibreOffice executable'
$sampleRoot = (Resolve-Path -LiteralPath $SampleDirectory).Path
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$outputFile = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path $outputRoot,(Split-Path -Parent $outputFile) | Out-Null
$version = (Get-Item -LiteralPath $soffice).VersionInfo.ProductVersion
if (-not $version) {
    $versionIni = Join-Path (Split-Path -Parent $soffice) 'version.ini'
    $version = if (Test-Path -LiteralPath $versionIni -PathType Leaf) {
        $updateId = (Get-Content -LiteralPath $versionIni | Select-String '^UpdateID=' | Select-Object -First 1).Line
        if ($updateId) { $updateId -replace '^UpdateID=', '' } else { 'version.ini present' }
    } else {
        'version metadata unavailable (child process probe skipped)'
    }
}
$allowedExtensions = @('.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp')
$results = [System.Collections.Generic.List[object]]::new()

foreach ($input in Get-ChildItem -LiteralPath $sampleRoot -File | Where-Object { $allowedExtensions -contains $_.Extension.ToLowerInvariant() }) {
    $format = $input.Extension.TrimStart('.').ToLowerInvariant()
    $targetDirectory = Join-Path $outputRoot ("$($input.BaseName)-$format")
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
    $profile = Join-Path $env:TEMP ('efficiency-lo-validation-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $profileUri = ([Uri]$profile).AbsoluteUri
    $arguments = @('-env:UserInstallation=' + $profileUri, '--headless', '--convert-to', 'pdf', '--outdir', $targetDirectory, $input.FullName)
    try {
        $process = Start-Process -FilePath $soffice -ArgumentList $arguments -PassThru -Wait
        $outputPdf = Join-Path $targetDirectory ($input.BaseName + '.pdf')
        $record = [ordered]@{
            input = $input.Name
            inputBytes = $input.Length
            inputSha256 = (Get-FileHash -LiteralPath $input.FullName -Algorithm SHA256).Hash
            format = $format
            exitCode = $process.ExitCode
            output = $outputPdf
            success = $process.ExitCode -eq 0 -and (Test-Path -LiteralPath $outputPdf -PathType Leaf)
        }
        if ($record.success) {
            $record.outputBytes = (Get-Item -LiteralPath $outputPdf).Length
            $record.outputSha256 = (Get-FileHash -LiteralPath $outputPdf -Algorithm SHA256).Hash
            if ($PdfInfoPath) {
                $pdfInfo = Resolve-Executable $PdfInfoPath 'pdfinfo executable'
                $pdfInfoCommand = '"{0}" "{1}" 2>nul' -f $pdfInfo, $outputPdf
                $info = & cmd.exe /d /c $pdfInfoCommand
                $pageLine = $info | Select-String '^Pages:' | Select-Object -First 1
                if ($pageLine) { $record.pages = [int](($pageLine.Line -split ':', 2)[1].Trim()) }
            }
        }
    } finally {
        Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
    }
    $results.Add([pscustomobject]$record)
}

$result = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    converter = [ordered]@{ path = $soffice; version = $version }
    sampleDirectory = $sampleRoot
    outputDirectory = $outputRoot
    summary = [ordered]@{
        requested = $results.Count
        successful = @($results | Where-Object success).Count
        failed = @($results | Where-Object { -not $_.success }).Count
        allSuccessful = (@($results | Where-Object { -not $_.success }).Count -eq 0 -and $results.Count -gt 0)
    }
    samples = $results
}
$json = $result | ConvertTo-Json -Depth 8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($outputFile, $json, $utf8NoBom)
Write-Host ($result.summary | ConvertTo-Json -Compress)
Write-Host ("Wrote Office conversion baseline: {0}" -f $outputFile)
