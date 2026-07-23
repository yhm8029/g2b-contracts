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

$shortcutArguments = New-PowerShellFileArguments -ScriptPath 'C:\Fixture Install\tools\portable\start-local-web.ps1'
Assert-True -Condition ($shortcutArguments -eq '-NoProfile -ExecutionPolicy Bypass -File "C:\Fixture Install\tools\portable\start-local-web.ps1"') `
    -Message 'Shortcut arguments must quote the PowerShell script path exactly once'

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

Write-Output 'portable_installer_tests=passed'
