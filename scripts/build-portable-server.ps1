<#
.SYNOPSIS
Stages a Windows portable Next.js standalone runtime from an existing build.

.DESCRIPTION
Copies .next/standalone and .next/static into the configurable output path, copies
the current node.exe into runtime, and creates empty data/config/logs directories
at the output root. SQLite databases and secret files are never copied.

The script does not run `npm run build`. Run `npm run build` separately to produce
.next/standalone before invoking this script.

.PARAMETER OutputPath
Absolute output directory. Defaults to <repo>\.runtime\portable-staging.
#>
[CmdletBinding()]
param(
    [string]$OutputPath,

    [string]$SourceRoot,

    [string]$NodeExecutablePath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Resolve-DefaultOutputPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    $defaultRoot = Join-Path $repositoryRoot '.runtime\portable-staging'
    if (Test-Path -LiteralPath $defaultRoot) {
        Remove-Item -LiteralPath $defaultRoot -Recurse -Force -ErrorAction Stop
    }
    return $defaultRoot
}

function Resolve-DefaultNodeExecutablePath {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -ne $nodeCommand -and -not [string]::IsNullOrEmpty($nodeCommand.Source)) {
        return $nodeCommand.Source
    }
    return (Join-Path $env:ProgramFiles 'nodejs\node.exe')
}

function Resolve-DefaultSourceRoot {
    return (Split-Path -Parent $PSScriptRoot)
}

function Assert-ValidOutputPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'OutputPath must not be empty.'
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        throw "OutputPath must be an absolute path: $Path"
    }
    $root = [System.IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrEmpty($root)) {
        throw "OutputPath must be an absolute path: $Path"
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
    $normalizedSource = [System.IO.Path]::GetFullPath($SourceRoot).Replace('/', '\').TrimEnd('\')
    if ($normalizedCandidate.Equals($normalizedSource, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "OutputPath must not equal SourceRoot: $normalizedCandidate"
    }

    $protectedDirectories = @(
        (Join-Path $normalizedSource '.next'),
        (Join-Path $normalizedSource 'node_modules'),
        (Join-Path $normalizedSource 'src')
    )

    foreach ($protectedDir in $protectedDirectories) {
        $protectedNormalized = $protectedDir.TrimEnd('\')
        if ($normalizedCandidate.Equals($protectedNormalized, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "OutputPath must not equal protected directory: $normalizedCandidate"
        }
        if ($normalizedCandidate.StartsWith($protectedNormalized + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "OutputPath must not be inside protected directory: $normalizedCandidate ($protectedNormalized)"
        }
    }
}

function Assert-NodeExecutableExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$NodePath
    )

    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
        throw "node.exe not found at: $NodePath"
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

function Initialize-EmptyDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $gitkeepPath = Join-Path $Path '.gitkeep'
    [System.IO.File]::WriteAllText($gitkeepPath, '')
}

$script:ResolvedSourceRoot = if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    Resolve-DefaultSourceRoot
}
else {
    [System.IO.Path]::GetFullPath($SourceRoot)
}

$script:ResolvedNodePath = if ([string]::IsNullOrWhiteSpace($NodeExecutablePath)) {
    Resolve-DefaultNodeExecutablePath
}
else {
    [System.IO.Path]::GetFullPath($NodeExecutablePath)
}

$script:ResolvedOutputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    Resolve-DefaultOutputPath -RepositoryRoot $script:ResolvedSourceRoot
}
else {
    [System.IO.Path]::GetFullPath($OutputPath)
}

Assert-ValidOutputPath -Path $script:ResolvedOutputPath
Assert-PathNotInsideProtectedDirectories `
    -CandidatePath $script:ResolvedOutputPath `
    -SourceRoot $script:ResolvedSourceRoot
Assert-NodeExecutableExists -NodePath $script:ResolvedNodePath

$standaloneSource = Join-Path $script:ResolvedSourceRoot '.next/standalone'
$staticSource = Join-Path $script:ResolvedSourceRoot '.next/static'
if (-not (Test-Path -LiteralPath $standaloneSource -PathType Container)) {
    throw "Standalone output missing. Run 'npm run build' first to produce .next/standalone."
}

if (Test-Path -LiteralPath $script:ResolvedOutputPath) {
    Remove-Item -LiteralPath $script:ResolvedOutputPath -Recurse -Force -ErrorAction Stop
}
New-Item -ItemType Directory -Path $script:ResolvedOutputPath -Force | Out-Null

$runtimeRoot = Join-Path $script:ResolvedOutputPath 'runtime'
$appRoot = Join-Path $runtimeRoot 'app'
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null


Copy-DirectorySafely `
    -SourcePath $standaloneSource `
    -DestinationPath $appRoot

Copy-DirectorySafely `
    -SourcePath $staticSource `
    -DestinationPath (Join-Path $appRoot '.next/static')

$nodeDestination = Join-Path $runtimeRoot 'node.exe'
Copy-Item -LiteralPath $script:ResolvedNodePath -Destination $nodeDestination -Force

Initialize-EmptyDirectory -Path (Join-Path $script:ResolvedOutputPath 'data')
Initialize-EmptyDirectory -Path (Join-Path $script:ResolvedOutputPath 'config')
Initialize-EmptyDirectory -Path (Join-Path $script:ResolvedOutputPath 'logs')

Write-Output "portable_staging_root=$script:ResolvedOutputPath"
Write-Output "portable_runtime_root=$runtimeRoot"
Write-Output 'build_step=completed'
