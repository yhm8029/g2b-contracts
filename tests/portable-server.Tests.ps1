[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$buildScriptPath = Join-Path $repositoryRoot 'scripts\build-portable-server.ps1'
$sourceRoot = $repositoryRoot
$nodeExecutable = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('g2b-portable-server-test-' + [guid]::NewGuid().ToString('N'))

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

function Test-StandaloneLayout {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RuntimeRoot
    )

    $appPath = Join-Path $RuntimeRoot 'app'
    Assert-True -Condition (Test-Path -LiteralPath $appPath -PathType Container) -Message 'runtime\app must exist'

    $packageJson = Join-Path $appPath 'package.json'
    Assert-True -Condition (Test-Path -LiteralPath $packageJson -PathType Leaf) -Message 'runtime\app\package.json must exist'

    $nextServer = Join-Path $appPath 'server.js'
    Assert-True -Condition (Test-Path -LiteralPath $nextServer -PathType Leaf) -Message 'runtime\app\server.js must exist'

    $staticPath = Join-Path $appPath '.next\static'
    Assert-True -Condition (Test-Path -LiteralPath $staticPath -PathType Container) -Message 'runtime\app\.next\static must exist'

    $nodeExePath = Join-Path $RuntimeRoot 'node.exe'
    Assert-True -Condition (Test-Path -LiteralPath $nodeExePath -PathType Leaf) -Message 'runtime\node.exe must exist'

    $stagingRoot = Split-Path -Parent $RuntimeRoot
    foreach ($dirName in @('data', 'config', 'logs')) {
        $dirPath = Join-Path $stagingRoot $dirName
        Assert-True -Condition (Test-Path -LiteralPath $dirPath -PathType Container) -Message "$dirName must exist at the output root"
        $files = @(Get-ChildItem -LiteralPath $dirPath -File -ErrorAction SilentlyContinue)
        $nonGitkeep = @($files | Where-Object { $_.Name -ne '.gitkeep' })
        Assert-True -Condition ($nonGitkeep.Count -eq 0) -Message "$dirName must contain only .gitkeep placeholder files"
    }
}

function Test-SecretsAndDatabaseExcluded {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RuntimeRoot
    )

    $excludePatterns = @(
        '*.sqlite',
        '*.sqlite-shm',
        '*.sqlite-wal',
        '*.sqlite-journal',
        '*.db',
        '*.db-shm',
        '*.db-wal',
        '.env',
        '.env.*',
        '.env.local',
        '.env.production',
        '.env.development',
        '*.pem',
        '*.key',
        '*.pfx',
        'secrets.json',
        'secrets/*',
        'config/secrets.json'
    )

    $violations = New-Object System.Collections.Generic.List[string]

    $stagingRoot = Split-Path -Parent $RuntimeRoot
    $allFiles = @(Get-ChildItem -LiteralPath $stagingRoot -Recurse -File -Force -ErrorAction SilentlyContinue)
    foreach ($file in $allFiles) {
        $relative = $file.FullName.Substring($stagingRoot.Length).TrimStart('\', '/').Replace('\', '/')
        foreach ($pattern in $excludePatterns) {
            if ($relative -like $pattern) {
                $violations.Add($relative)
                break
            }
        }
    }

    Assert-True -Condition ($violations.Count -eq 0) `
        -Message "Forbidden files present in staging output: $($violations -join ', ')"
}

try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File $buildScriptPath `
        -SourceRoot $sourceRoot `
        -OutputPath $stagingRoot `
        -NodeExecutablePath $nodeExecutable 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference

    Assert-True -Condition ($exitCode -eq 0) -Message "build-portable-server.ps1 failed with exit code $exitCode"

    $runtimeRoot = Join-Path $stagingRoot 'runtime'
    Assert-True -Condition (Test-Path -LiteralPath $runtimeRoot -PathType Container) -Message "runtime directory must exist at $runtimeRoot"

    Test-StandaloneLayout -RuntimeRoot $runtimeRoot
    Test-SecretsAndDatabaseExcluded -RuntimeRoot $runtimeRoot

    Write-Output 'portable_server_test=passed'
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
