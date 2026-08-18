[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$builder = Join-Path $repositoryRoot 'scripts\build-tauri-portable.ps1'
$releaseExe = Join-Path $repositoryRoot 'src-tauri\target\release\g2b-competitor-sales.exe'
$standalone = Join-Path $repositoryRoot '.next\standalone'
$folderName = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String('64KY65287J6l7YSwIOqyveyfgeyCrCDsmIHsl4XshLHqs7w=')
)
$outputRoot = Join-Path ([IO.Path]::GetTempPath()) ('g2b-tauri-test-' + [guid]::NewGuid().ToString('N'))
$previousKey = $env:DATA_GO_KR_SERVICE_KEY

function Assert-True {
    param(
        [Parameter(Mandatory = $true)] [bool]$Condition,
        [Parameter(Mandatory = $true)] [string]$Message
    )
    if (-not $Condition) { throw "Assertion failed: $Message" }
}

try {
    Assert-True -Condition (Test-Path -LiteralPath $builder -PathType Leaf) -Message 'builder is missing'
    Assert-True -Condition (Test-Path -LiteralPath $releaseExe -PathType Leaf) -Message 'release exe is missing'
    Assert-True -Condition (Test-Path -LiteralPath $standalone -PathType Container) -Message 'standalone build is missing'

    $env:DATA_GO_KR_SERVICE_KEY = 'test-public-key'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $builder `
        -OutputRoot $outputRoot -SkipNpmBuild -SkipCargoBuild | Out-Null
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message "builder exited with $LASTEXITCODE"

    $portableRoot = Join-Path $outputRoot $folderName
    $requiredPaths = @(
        (Join-Path $portableRoot ($folderName + '.exe')),
        (Join-Path $portableRoot 'runtime\node.exe'),
        (Join-Path $portableRoot 'runtime\app\server.js'),
        (Join-Path $portableRoot 'data'),
        (Join-Path $portableRoot 'config'),
        (Join-Path $portableRoot 'logs')
    )
    foreach ($path in $requiredPaths) {
        Assert-True -Condition (Test-Path -LiteralPath $path) -Message "required path is missing: $path"
    }

    $databases = @(Get-ChildItem -LiteralPath $portableRoot -Recurse -File |
        Where-Object { $_.Name -like '*.sqlite*' -or $_.Name -like '*.db' })
    Assert-True -Condition ($databases.Count -eq 0) -Message 'database files must not be packaged'

    $appEnv = Get-Content -Raw -LiteralPath (Join-Path $portableRoot 'config\app.env')
    Assert-True -Condition ($appEnv -match 'DATA_GO_KR_SERVICE_KEY=test-public-key') -Message 'process key must win'
    Assert-True -Condition ($appEnv -notmatch 'MINIMAX_API_KEY') -Message 'MiniMax key must not be packaged'
    Write-Output 'tauri_portable_test=passed'
}
finally {
    if ($null -eq $previousKey) {
        Remove-Item Env:DATA_GO_KR_SERVICE_KEY -ErrorAction SilentlyContinue
    }
    else {
        $env:DATA_GO_KR_SERVICE_KEY = $previousKey
    }
    if (Test-Path -LiteralPath $outputRoot) {
        Remove-Item -LiteralPath $outputRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
