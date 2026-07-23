[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $repositoryRoot 'scripts\install-portable-desktop.ps1'

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

function Get-ScriptAst {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    Assert-True -Condition (Test-Path -LiteralPath $Path -PathType Leaf) -Message 'Portable installer script was not found'

    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $Path,
        [ref]$tokens,
        [ref]$errors
    )
    Assert-True -Condition ($errors.Count -eq 0) -Message "$Path has parser errors"
    return $ast
}

function Get-FunctionDefinition {
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.Language.ScriptBlockAst]$Ast,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $functionAst = $Ast.Find(
        {
            param($node)
            ($node -is [System.Management.Automation.Language.FunctionDefinitionAst]) -and
                ($node.Name -eq $Name)
        },
        $true
    )
    Assert-True -Condition ($null -ne $functionAst) -Message "Function $Name was not found"
    return $functionAst.Extent.Text
}

$installerAst = Get-ScriptAst -Path $installerPath

Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Normalize-PathForComparison')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Test-PathIsDescendant')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Test-ExistingDestinationCanBeRemoved')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'New-PowerShellFileArguments')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Test-ArchiveContainsGitMetadata')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Get-PortableToolPath')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Copy-RequiredSourceFiles')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'New-InstallerOwnedSiblingPath')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Test-InstallerOwnedSiblingPath')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Remove-InstallerOwnedDirectory')
Invoke-Expression (Get-FunctionDefinition -Ast $installerAst -Name 'Complete-StagedInstallation')

$desktopFixture = 'C:\Fixture User\Desktop'
$expectedDestinationFixture = Join-Path $desktopFixture 'portable-app'
Assert-True -Condition (Test-PathIsDescendant `
        -CandidatePath $expectedDestinationFixture `
        -ParentPath $desktopFixture) -Message 'Expected desktop descendant must be accepted'
Assert-True -Condition (-not (Test-PathIsDescendant `
            -CandidatePath (Join-Path $desktopFixture 'portable-app-backup') `
            -ParentPath $expectedDestinationFixture)) -Message 'Sibling path must not pass a descendant boundary check'
Assert-True -Condition (-not (Test-PathIsDescendant `
            -CandidatePath $desktopFixture `
            -ParentPath $desktopFixture)) -Message 'Parent path itself must not pass a descendant boundary check'

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('g2b-installer-test-' + [guid]::NewGuid().ToString('N'))
try {
    $fixtureTarget = Join-Path $fixtureRoot 'target'
    New-Item -ItemType Directory -Path $fixtureTarget -Force | Out-Null
    Assert-True -Condition (-not (Test-ExistingDestinationCanBeRemoved -DestinationRoot $fixtureTarget)) `
        -Message 'Existing target without an installer marker must be protected from recursive deletion'

    $markerPath = Join-Path $fixtureTarget '.g2b-portable-install.json'
    '{"version":"0.1.0","installedAt":"2026-07-23T00:00:00.0000000Z","sourceCommit":"abc123"}' | Set-Content -LiteralPath $markerPath -Encoding UTF8
    Assert-True -Condition (Test-ExistingDestinationCanBeRemoved -DestinationRoot $fixtureTarget) `
        -Message 'Existing target with a valid installer marker must be replaceable'
}
finally {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$shortcutTarget = Get-PortableToolPath `
    -InstallRoot 'C:\Fixture Install' `
    -ScriptName 'start-local-web.ps1'
$shortcutArguments = New-PowerShellFileArguments -ScriptPath $shortcutTarget
Assert-True -Condition ($shortcutArguments -eq '-NoProfile -ExecutionPolicy Bypass -File "C:\Fixture Install\tools\start-local-web.ps1"') `
    -Message 'Shortcut arguments must quote the PowerShell script path exactly once'

try {
    $sourceFixture = Join-Path $fixtureRoot 'source'
    $destinationFixture = Join-Path $fixtureRoot 'destination'
    foreach ($fixtureDirectory in @(
            $sourceFixture,
            (Join-Path $sourceFixture 'data'),
            (Join-Path $sourceFixture 'tools\portable'),
            (Join-Path $destinationFixture 'app'),
            (Join-Path $destinationFixture 'data'),
            (Join-Path $destinationFixture 'tools')
        )) {
        New-Item -ItemType Directory -Path $fixtureDirectory -Force | Out-Null
    }
    'fixture-env' | Set-Content -LiteralPath (Join-Path $sourceFixture '.env.local')
    'fixture-db' | Set-Content -LiteralPath (Join-Path $sourceFixture 'data\g2b-contracts.sqlite')
    'start-fixture' | Set-Content -LiteralPath (Join-Path $sourceFixture 'tools\portable\start-local-web.ps1')
    'stop-fixture' | Set-Content -LiteralPath (Join-Path $sourceFixture 'tools\portable\stop-local-web.ps1')

    Copy-RequiredSourceFiles -SourceRoot $sourceFixture -DestinationRoot $destinationFixture

    $copiedStartPath = Get-PortableToolPath `
        -InstallRoot $destinationFixture `
        -ScriptName 'start-local-web.ps1'
    $copiedStopPath = Get-PortableToolPath `
        -InstallRoot $destinationFixture `
        -ScriptName 'stop-local-web.ps1'
    Assert-True -Condition (Test-Path -LiteralPath $copiedStartPath -PathType Leaf) `
        -Message 'Start shortcut target must be the path actually copied into root tools'
    Assert-True -Condition (Test-Path -LiteralPath $copiedStopPath -PathType Leaf) `
        -Message 'Stop shortcut target must be the path actually copied into root tools'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $destinationFixture 'tools\portable'))) `
        -Message 'Installed portable scripts must not be nested below tools\portable'

    $stagingPath = New-InstallerOwnedSiblingPath `
        -DestinationRoot $destinationFixture `
        -Purpose 'installing'
    New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null
    'partial' | Set-Content -LiteralPath (Join-Path $stagingPath 'partial.txt')
    Remove-InstallerOwnedDirectory `
        -Path $stagingPath `
        -ExpectedPath $stagingPath `
        -DestinationRoot $destinationFixture
    Assert-True -Condition (-not (Test-Path -LiteralPath $stagingPath)) `
        -Message 'Installer-owned partial staging directory must be cleaned after failure'
    Assert-True -Condition (Test-Path -LiteralPath $destinationFixture -PathType Container) `
        -Message 'Staging cleanup must not remove the destination directory'

    $existingDestinationFixture = Join-Path $fixtureRoot 'existing-destination'
    New-Item -ItemType Directory -Path $existingDestinationFixture -Force | Out-Null
    '{"version":"0.1.0","installedAt":"2026-07-23T00:00:00.0000000Z","sourceCommit":"old123"}' |
        Set-Content -LiteralPath (Join-Path $existingDestinationFixture '.g2b-portable-install.json') -Encoding UTF8
    'previous-install' | Set-Content -LiteralPath (Join-Path $existingDestinationFixture 'previous.txt')
    $missingStagingFixture = New-InstallerOwnedSiblingPath `
        -DestinationRoot $existingDestinationFixture `
        -Purpose 'installing'
    $swapFailed = $false
    try {
        Complete-StagedInstallation `
            -StagingRoot $missingStagingFixture `
            -DestinationRoot $existingDestinationFixture
    }
    catch {
        $swapFailed = $true
    }
    Assert-True -Condition $swapFailed -Message 'Missing staging source must fail the swap'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $existingDestinationFixture 'previous.txt') -PathType Leaf) `
        -Message 'Failed swap must restore the previous marked installation'
}
finally {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Assert-True -Condition (-not (Test-ArchiveContainsGitMetadata -EntryNames @(
            'package.json',
            'src/app/page.tsx',
            'tools/portable/start-local-web.ps1'
        ))) -Message 'Tracked archive entries must not include .git metadata'
Assert-True -Condition (Test-ArchiveContainsGitMetadata -EntryNames @('.git/config')) `
    -Message 'Archive metadata guard must detect .git entries'

$installerText = Get-Content -Raw -LiteralPath $installerPath
Assert-True -Condition ($installerText -match 'git.*archive') -Message 'Installer must export app files with git archive'
Assert-True -Condition ($installerText -match 'Expand-Archive') -Message 'Installer must extract the git archive safely'
Assert-True -Condition ($installerText -match 'G2B_INSTALLER_NONINTERACTIVE') -Message 'Installer must support noninteractive user-error fallback'
Assert-True -Condition ($installerText -match 'Get-ListeningProcessIds') -Message 'Installer must refuse to alter a running server'
Assert-True -Condition ($installerText -match "-Name\s+'npm\.cmd'") `
    -Message 'Installer must resolve npm.cmd explicitly'
Assert-True -Condition ($installerText -match '(?s)finally\s*\{.*Remove-InstallerOwnedDirectory') `
    -Message 'Installer must clean its partial staging directory in a finally block'

Write-Output 'portable_installer_tests=passed'
