<#
.SYNOPSIS
Builds the Windows portable Tauri competitor-sales application.

.DESCRIPTION
Runs `npm run build` to produce the Next.js standalone server, invokes
scripts/build-portable-server.ps1 to stage the portable runtime beside an
empty data/config/logs directory, runs `cargo build --release` to compile the
Tauri shell, and assembles the final portable folder at <repo>/dist/<FolderName>.

The script never copies .env.local, SQLite databases, or other secrets into
the portable folder. The only persisted runtime configuration is
config/app.env, written from .env.local and limited to DATA_GO_KR_SERVICE_KEY.
The local-only API key is never logged.

.PARAMETER OutputRoot
Directory that receives the portable folder. Defaults to <repo>/dist.

.PARAMETER FolderName
Name of the portable folder and the user-facing EXE. Defaults to the Korean
application title.

.PARAMETER SkipNpmBuild
Skips `npm run build`. Useful when the Next standalone output is already
current.

.PARAMETER SkipCargoBuild
Skips `cargo build --release`. Useful when the Tauri exe is already current.
#>
[CmdletBinding()]
param(
    [string]$OutputRoot,

    [string]$FolderName,

    [switch]$SkipNpmBuild,

    [switch]$SkipCargoBuild
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function ConvertFrom-Utf8Base64 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return [System.Text.Encoding]::UTF8.GetString(
        [System.Convert]::FromBase64String($Value)
    )
}

function Get-PortableFolderName {
    return ConvertFrom-Utf8Base64 `
        -Value '64KY65287J6l7YSwIOqyveyfgeyCrCDsmIHsl4XshLHqs7w='
}

function Resolve-DefaultOutputRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    return (Join-Path $repositoryRoot 'dist')
}

function Assert-ValidOutputRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'OutputRoot must not be empty.'
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        throw "OutputRoot must be an absolute path: $Path"
    }
    $root = [System.IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrEmpty($root)) {
        throw "OutputRoot must be an absolute path: $Path"
    }
}

function Assert-PathNotInsideProtectedDirectories {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CandidatePath,

        [Parameter(Mandatory = $true)]
        [string]$SourceRoot
    )

    $normalizedCandidate = [System.IO.Path]::GetFullPath($CandidatePath).Replace('/', '\').TrimEnd('\')
    $normalizedSourceRoot = [System.IO.Path]::GetFullPath($SourceRoot).Replace('/', '\').TrimEnd('\')
    $protectedDirectories = @(
        (Join-Path $normalizedSourceRoot '.git'),
        (Join-Path $normalizedSourceRoot 'node_modules'),
        (Join-Path $normalizedSourceRoot '.next'),
        (Join-Path $normalizedSourceRoot 'src'),
        (Join-Path $normalizedSourceRoot 'src-tauri')
    )

    foreach ($protectedDir in $protectedDirectories) {
        $protectedNormalized = $protectedDir.TrimEnd('\')
        if ($normalizedCandidate.Equals($protectedNormalized, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "OutputRoot must not equal protected directory: $normalizedCandidate"
        }
        if ($normalizedCandidate.StartsWith($protectedNormalized + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "OutputRoot must not be inside protected directory: $normalizedCandidate ($protectedNormalized)"
        }
    }
}

function Copy-DirectorySafely {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,

        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    if (-not (Test-Path -LiteralPath $SourcePath)) {
        throw "Required source path does not exist: $SourcePath"
    }

    if (Test-Path -LiteralPath $DestinationPath) {
        Remove-Item -LiteralPath $DestinationPath -Recurse -Force -ErrorAction Stop
    }

    New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    Copy-Item -Path (Join-Path $SourcePath '*') -Destination $DestinationPath -Recurse -Force
}

function Invoke-NpmBuild {
    if ($SkipNpmBuild) {
        Write-Output 'build_step=npm_build_skipped'
        return
    }

    Write-Output 'build_step=npm_build_start'
    npm run build | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE"
    }
    Write-Output 'build_step=npm_build_completed'
}

function Invoke-CargoBuild {
    if ($SkipCargoBuild) {
        Write-Output 'build_step=cargo_build_skipped'
        return
    }

    $manifestPath = Join-Path $script:ResolvedSourceRoot 'src-tauri/Cargo.toml'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Tauri manifest not found: $manifestPath"
    }

    Write-Output 'build_step=cargo_build_start'
    cargo build --release --manifest-path $manifestPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build failed with exit code $LASTEXITCODE"
    }
    Write-Output 'build_step=cargo_build_completed'
}

function Read-AllowedEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $allowed = @(
        'DATA_GO_KR_SERVICE_KEY'
    )
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $values
    }

    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrEmpty($line)) { continue }
        if ($line.StartsWith('#')) { continue }
        $separatorIndex = $line.IndexOf('=')
        if ($separatorIndex -lt 0) { continue }
        $key = $line.Substring(0, $separatorIndex).Trim()
        $value = $line.Substring($separatorIndex + 1).Trim().Trim('"').Trim("'")
        if ($allowed -contains $key -and -not [string]::IsNullOrEmpty($value)) {
            $values[$key] = $value
        }
    }
    return $values
}

function Write-AppEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigRoot,
        [hashtable]$Values
    )

    if (-not (Test-Path -LiteralPath $ConfigRoot)) {
        New-Item -ItemType Directory -Path $ConfigRoot -Force | Out-Null
    }

    $envPath = Join-Path $ConfigRoot 'app.env'
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('# Local public-data API key copied from .env.local during packaging.')
    $lines.Add('# Other secrets are never copied into this file.')
    $lines.Add('# Edit this file directly to change the bundled key.')
    if ($Values.ContainsKey('DATA_GO_KR_SERVICE_KEY')) {
        $lines.Add(('DATA_GO_KR_SERVICE_KEY={0}' -f $Values['DATA_GO_KR_SERVICE_KEY']))
    }
    else {
        $lines.Add('# DATA_GO_KR_SERVICE_KEY=')
    }
    [System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
}

$script:ResolvedSourceRoot = (Split-Path -Parent $PSScriptRoot)

$script:ResolvedFolderName = if ([string]::IsNullOrWhiteSpace($FolderName)) {
    Get-PortableFolderName
}
else {
    $FolderName
}

$script:ResolvedOutputRoot = if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    Resolve-DefaultOutputRoot -RepositoryRoot $script:ResolvedSourceRoot
}
else {
    [System.IO.Path]::GetFullPath($OutputRoot)
}

Assert-ValidOutputRoot -Path $script:ResolvedOutputRoot
Assert-PathNotInsideProtectedDirectories `
    -CandidatePath $script:ResolvedOutputRoot `
    -SourceRoot $script:ResolvedSourceRoot

Invoke-NpmBuild

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('g2b-tauri-portable-' + [guid]::NewGuid().ToString('N'))
$portableServerScript = Join-Path $script:ResolvedSourceRoot 'scripts/build-portable-server.ps1'
if (-not (Test-Path -LiteralPath $portableServerScript -PathType Leaf)) {
    throw "Portable server build script not found: $portableServerScript"
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand -or [string]::IsNullOrEmpty($nodeCommand.Source)) {
    throw 'node.exe was not found on PATH. Install Node.js or ensure it is available on PATH.'
}

try {
    Write-Output 'build_step=portable_server_stage_start'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File $portableServerScript `
        -SourceRoot $script:ResolvedSourceRoot `
        -OutputPath $stagingRoot `
        -NodeExecutablePath $nodeCommand.Source | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "scripts/build-portable-server.ps1 failed with exit code $LASTEXITCODE"
    }
    Write-Output 'build_step=portable_server_stage_completed'

    Invoke-CargoBuild

    $releaseExe = Join-Path $script:ResolvedSourceRoot 'src-tauri/target/release/g2b-competitor-sales.exe'
    if (-not (Test-Path -LiteralPath $releaseExe -PathType Leaf)) {
        throw "Tauri release executable not found at $releaseExe. Build the Tauri shell before running this script."
    }

    $distRoot = $script:ResolvedOutputRoot
    $portableRoot = Join-Path $distRoot $script:ResolvedFolderName
    if (Test-Path -LiteralPath $portableRoot) {
        Remove-Item -LiteralPath $portableRoot -Recurse -Force -ErrorAction Stop
    }
    New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $portableRoot -Force | Out-Null

    $targetExe = Join-Path $portableRoot ('{0}.exe' -f $script:ResolvedFolderName)
    Copy-Item -LiteralPath $releaseExe -Destination $targetExe -Force

    Copy-DirectorySafely -SourcePath (Join-Path $stagingRoot 'runtime') -DestinationPath (Join-Path $portableRoot 'runtime')
    Copy-DirectorySafely -SourcePath (Join-Path $stagingRoot 'data') -DestinationPath (Join-Path $portableRoot 'data')
    Copy-DirectorySafely -SourcePath (Join-Path $stagingRoot 'config') -DestinationPath (Join-Path $portableRoot 'config')
    Copy-DirectorySafely -SourcePath (Join-Path $stagingRoot 'logs') -DestinationPath (Join-Path $portableRoot 'logs')

    $envValues = Read-AllowedEnvFile -Path (Join-Path $script:ResolvedSourceRoot '.env.local')
    if (-not [string]::IsNullOrWhiteSpace($env:DATA_GO_KR_SERVICE_KEY)) {
        $envValues['DATA_GO_KR_SERVICE_KEY'] = $env:DATA_GO_KR_SERVICE_KEY.Trim()
    }
    Write-AppEnvFile -ConfigRoot (Join-Path $portableRoot 'config') -Values $envValues
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$exeSize = (Get-Item -LiteralPath $targetExe).Length
$runtimeSize = (Get-ChildItem -LiteralPath (Join-Path $portableRoot 'runtime') -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum
$totalSize = (Get-ChildItem -LiteralPath $portableRoot -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum

Write-Output "portable_root=$portableRoot"
Write-Output "portable_exe=$targetExe"
Write-Output "portable_exe_bytes=$exeSize"
Write-Output "portable_runtime_bytes=$runtimeSize"
Write-Output "portable_total_bytes=$totalSize"
Write-Output 'build_step=completed'

