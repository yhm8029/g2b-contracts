[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $repositoryRoot 'scripts\install-portable-desktop.ps1'
$fixtureRoot = Join-Path (
    [System.IO.Path]::GetTempPath()
) ('g2b-installer-test-' + [guid]::NewGuid().ToString('N'))
$createdReparsePoint = $null

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

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $threw = $false
    try {
        & $Action
    }
    catch {
        $threw = $true
    }

    Assert-True -Condition $threw -Message $Message
}

function Convert-CodePointsToString {
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$CodePoints
    )

    return -join @($CodePoints | ForEach-Object { [char]$_ })
}

function Invoke-NodeSqlite {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DatabasePath,

        [Parameter(Mandatory = $true)]
        [string]$JavaScript,

        [string]$Sql = ''
    )

    Push-Location -LiteralPath $repositoryRoot
    try {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $output = & node.exe -e $JavaScript $DatabasePath $Sql 2>&1
        $ErrorActionPreference = $previousErrorActionPreference
        if ($LASTEXITCODE -ne 0) {
            throw "Node SQLite fixture failed: $($output | Out-String)"
        }
        return @($output)
    }
    finally {
        $ErrorActionPreference = 'Stop'
        Pop-Location
    }
}

Assert-True -Condition (Test-Path -LiteralPath $installerPath -PathType Leaf) `
    -Message 'Portable installer script was not found'

$tokens = $null
$parserErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
    $installerPath,
    [ref]$tokens,
    [ref]$parserErrors
)
Assert-True -Condition ($parserErrors.Count -eq 0) `
    -Message 'Portable installer has parser errors'

$installerBytes = [System.IO.File]::ReadAllBytes($installerPath)
$nonAsciiBytes = @($installerBytes | Where-Object { $_ -gt 127 })
Assert-True -Condition ($nonAsciiBytes.Count -eq 0) `
    -Message 'Portable installer source must contain ASCII bytes only'

. $installerPath

$expectedFolderName = Convert-CodePointsToString -CodePoints @(
    45208, 46972, 51109, 53552, 32, 44221, 51137, 49324, 32,
    50689, 50629, 49457, 44284
)
$expectedStartShortcut = Convert-CodePointsToString -CodePoints @(
    49892, 54665, 46, 108, 110, 107
)
$expectedStopShortcut = Convert-CodePointsToString -CodePoints @(
    51333, 47308, 46, 108, 110, 107
)
Assert-True -Condition ((Get-PortableFolderName) -ceq $expectedFolderName) `
    -Message 'Portable folder name must decode to the exact Korean text'
Assert-True -Condition ((Get-StartShortcutName) -ceq $expectedStartShortcut) `
    -Message 'Start shortcut name must decode to the exact Korean text'
Assert-True -Condition ((Get-StopShortcutName) -ceq $expectedStopShortcut) `
    -Message 'Stop shortcut name must decode to the exact Korean text'

$desktopFixture = 'C:\Fixture User\Desktop'
$expectedDestinationFixture = Join-Path $desktopFixture 'portable-app'
Assert-True -Condition (Test-PathIsDescendant `
        -CandidatePath $expectedDestinationFixture `
        -ParentPath $desktopFixture) `
    -Message 'Expected desktop descendant must be accepted'
Assert-True -Condition (-not (Test-PathIsDescendant `
            -CandidatePath (Join-Path $desktopFixture 'portable-app-backup') `
            -ParentPath $expectedDestinationFixture)) `
    -Message 'Sibling path must not pass a descendant boundary check'
Assert-True -Condition (-not (Test-PathIsDescendant `
            -CandidatePath $desktopFixture `
            -ParentPath $desktopFixture)) `
    -Message 'Parent path itself must not pass a descendant boundary check'

New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
try {
    $markerTarget = Join-Path $fixtureRoot 'marker target'
    New-Item -ItemType Directory -Path $markerTarget -Force | Out-Null
    Assert-True -Condition (-not (Test-ExistingDestinationCanBeRemoved `
            -DestinationRoot $markerTarget)) `
        -Message 'An unmarked target must not be replaceable'

    Write-InstallMarker `
        -InstallRoot $markerTarget `
        -DestinationRoot $markerTarget `
        -SourceCommit ('a' * 40) `
        -Version '0.1.0'
    Assert-True -Condition (Test-ExistingDestinationCanBeRemoved `
            -DestinationRoot $markerTarget) `
        -Message 'A correctly marked target must be replaceable'

    $markerPath = Join-Path $markerTarget '.g2b-portable-install.json'
    $validMarker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    $validMarker.installationId = 'forged-installation'
    $validMarker | ConvertTo-Json | Set-Content -LiteralPath $markerPath -Encoding UTF8
    Assert-True -Condition (-not (Test-ExistingDestinationCanBeRemoved `
            -DestinationRoot $markerTarget)) `
        -Message 'A forged installation ID must be rejected'

    Write-InstallMarker `
        -InstallRoot $markerTarget `
        -DestinationRoot (Join-Path $fixtureRoot 'different target') `
        -SourceCommit ('b' * 40) `
        -Version '0.1.0'
    Assert-True -Condition (-not (Test-ExistingDestinationCanBeRemoved `
            -DestinationRoot $markerTarget)) `
        -Message 'A marker bound to a different destination must be rejected'

    '{"installationId":"g2b-contracts-portable-desktop-v1","destinationRoot":"C:\\wrong","version":"0.1.0","installedAt":"not-a-date","sourceCommit":"abc123"}' |
        Set-Content -LiteralPath $markerPath -Encoding UTF8
    Assert-True -Condition (-not (Test-ExistingDestinationCanBeRemoved `
            -DestinationRoot $markerTarget)) `
        -Message 'A marker with invalid metadata must be rejected'

    $ownershipTarget = New-InstallerOwnedSiblingPath `
        -DestinationRoot $markerTarget `
        -Purpose 'installing'
    Initialize-InstallerOwnedDirectory `
        -Path $ownershipTarget `
        -ExpectedParent (Split-Path -Parent $markerTarget) `
        -Purpose 'installing' `
        -DestinationRoot $markerTarget
    Assert-True -Condition (Test-InstallerOwnedDirectory `
            -Path $ownershipTarget `
            -ExpectedPath $ownershipTarget `
            -ExpectedParent (Split-Path -Parent $markerTarget) `
            -Purpose 'installing' `
            -DestinationRoot $markerTarget) `
        -Message 'A correctly owned staging directory must validate'

    $ownershipMarkerPath = Join-Path $ownershipTarget '.g2b-installer-owned.json'
    $ownershipMarker = Get-Content -LiteralPath $ownershipMarkerPath -Raw |
        ConvertFrom-Json
    $ownershipMarker.destinationRoot = (Join-Path $fixtureRoot 'wrong destination')
    $ownershipMarker | ConvertTo-Json |
        Set-Content -LiteralPath $ownershipMarkerPath -Encoding UTF8
    Assert-Throws -Action {
        Remove-InstallerOwnedDirectory `
            -Path $ownershipTarget `
            -ExpectedPath $ownershipTarget `
            -ExpectedParent (Split-Path -Parent $markerTarget) `
            -Purpose 'installing' `
            -DestinationRoot $markerTarget
    } -Message 'Cleanup must reject a forged ownership marker'

    Remove-Item -LiteralPath $ownershipTarget -Recurse -Force
    Initialize-InstallerOwnedDirectory `
        -Path $ownershipTarget `
        -ExpectedParent (Split-Path -Parent $markerTarget) `
        -Purpose 'installing' `
        -DestinationRoot $markerTarget
    $reparseTarget = Join-Path $fixtureRoot 'reparse target'
    New-Item -ItemType Directory -Path $reparseTarget -Force | Out-Null
    $reparsePath = Join-Path $ownershipTarget 'nested-link'
    try {
        New-Item -ItemType Junction -Path $reparsePath -Target $reparseTarget `
            -ErrorAction Stop | Out-Null
        $createdReparsePoint = $reparsePath
        Assert-Throws -Action {
            Remove-InstallerOwnedDirectory `
                -Path $ownershipTarget `
                -ExpectedPath $ownershipTarget `
                -ExpectedParent (Split-Path -Parent $markerTarget) `
                -Purpose 'installing' `
                -DestinationRoot $markerTarget
        } -Message 'Cleanup must reject a nested reparse point'
        Remove-Item -LiteralPath $reparsePath -Force
        $createdReparsePoint = $null
    }
    catch {
        if ($null -ne $createdReparsePoint) {
            throw
        }
        Write-Output 'portable_installer_reparse_test=skipped'
    }
    Remove-InstallerOwnedDirectory `
        -Path $ownershipTarget `
        -ExpectedPath $ownershipTarget `
        -ExpectedParent (Split-Path -Parent $markerTarget) `
        -Purpose 'installing' `
        -DestinationRoot $markerTarget

    $protectedDestination = Join-Path $fixtureRoot 'protected destination'
    New-Item -ItemType Directory -Path $protectedDestination -Force | Out-Null
    'previous-install' | Set-Content `
        -LiteralPath (Join-Path $protectedDestination 'previous.txt')
    Write-InstallMarker `
        -InstallRoot $protectedDestination `
        -DestinationRoot $protectedDestination `
        -SourceCommit ('c' * 40) `
        -Version '0.1.0'
    $unmarkedStaging = New-InstallerOwnedSiblingPath `
        -DestinationRoot $protectedDestination `
        -Purpose 'installing'
    Initialize-InstallerOwnedDirectory `
        -Path $unmarkedStaging `
        -ExpectedParent (Split-Path -Parent $protectedDestination) `
        -Purpose 'installing' `
        -DestinationRoot $protectedDestination
    'untrusted-install' | Set-Content `
        -LiteralPath (Join-Path $unmarkedStaging 'untrusted.txt')
    Assert-Throws -Action {
        Complete-StagedInstallation `
            -StagingRoot $unmarkedStaging `
            -DestinationRoot $protectedDestination
    } -Message 'An unmarked staging directory must not replace an installation'
    Assert-True -Condition (Test-Path `
            -LiteralPath (Join-Path $protectedDestination 'previous.txt') `
            -PathType Leaf) `
        -Message 'Rejected staging must leave the previous installation in place'
    Remove-InstallerOwnedDirectory `
        -Path $unmarkedStaging `
        -ExpectedPath $unmarkedStaging `
        -ExpectedParent (Split-Path -Parent $protectedDestination) `
        -Purpose 'installing' `
        -DestinationRoot $protectedDestination

    $missingStaging = New-InstallerOwnedSiblingPath `
        -DestinationRoot $protectedDestination `
        -Purpose 'installing'
    Assert-Throws -Action {
        Complete-StagedInstallation `
            -StagingRoot $missingStaging `
            -DestinationRoot $protectedDestination
    } -Message 'A missing staging directory must fail the swap'
    Assert-True -Condition (Test-Path `
            -LiteralPath (Join-Path $protectedDestination 'previous.txt') `
            -PathType Leaf) `
        -Message 'A failed swap must restore the previous installation'
    Assert-True -Condition (Test-ExistingDestinationCanBeRemoved `
            -DestinationRoot $protectedDestination) `
        -Message 'A restored installation must retain its valid install marker'

    $sourceDb = Join-Path $fixtureRoot 'source.sqlite'
    $snapshotDb = Join-Path $fixtureRoot 'snapshot.sqlite'
    $createScript = @'
const Database = require('better-sqlite3');
const db = new Database(process.argv[1]);
db.exec(process.argv[2]);
db.close();
'@
    [void](Invoke-NodeSqlite `
        -DatabasePath $sourceDb `
        -JavaScript $createScript `
        -Sql 'CREATE TABLE sales(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO sales(name) VALUES (''first'');')
    Invoke-SqliteBackup `
        -SourceRoot $repositoryRoot `
        -DatabaseSource $sourceDb `
        -DatabaseDestination $snapshotDb
    [void](Invoke-NodeSqlite `
        -DatabasePath $sourceDb `
        -JavaScript $createScript `
        -Sql 'INSERT INTO sales(name) VALUES (''second'');')
    $queryScript = @'
const Database = require('better-sqlite3');
const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
console.log(db.prepare(process.argv[2]).pluck().get());
db.close();
'@
    $snapshotCount = [string](Invoke-NodeSqlite `
        -DatabasePath $snapshotDb `
        -JavaScript $queryScript `
        -Sql 'SELECT COUNT(*) FROM sales')
    Assert-True -Condition ($snapshotCount.Trim() -eq '1') `
        -Message 'SQLite backup must be a stable snapshot independent of later writes'
    $quickCheck = [string](Invoke-NodeSqlite `
        -DatabasePath $snapshotDb `
        -JavaScript $queryScript `
        -Sql 'PRAGMA quick_check')
    Assert-True -Condition ($quickCheck.Trim() -eq 'ok') `
        -Message 'SQLite backup must pass quick_check'

    $copyDestination = Join-Path $fixtureRoot 'copy destination'
    foreach ($directoryName in @('app', 'data', 'tools')) {
        New-Item -ItemType Directory `
            -Path (Join-Path $copyDestination $directoryName) `
            -Force | Out-Null
    }
    Copy-RequiredSourceFiles `
        -SourceRoot $repositoryRoot `
        -DestinationRoot $copyDestination
    $copiedStartPath = Get-PortableToolPath `
        -InstallRoot $copyDestination `
        -ScriptName 'start-local-web.ps1'
    $copiedStopPath = Get-PortableToolPath `
        -InstallRoot $copyDestination `
        -ScriptName 'stop-local-web.ps1'
    Assert-True -Condition (Test-Path -LiteralPath $copiedStartPath -PathType Leaf) `
        -Message 'Start tool must be copied to the root tools directory'
    Assert-True -Condition (Test-Path -LiteralPath $copiedStopPath -PathType Leaf) `
        -Message 'Stop tool must be copied to the root tools directory'
    Assert-True -Condition (-not (Test-Path -LiteralPath (
                Join-Path $copyDestination 'tools\portable'
            ))) `
        -Message 'Installed tools must not be nested below tools\portable'
    Assert-True -Condition (-not (Test-Path -LiteralPath (
                Join-Path $copyDestination 'data\g2b-contracts.sqlite-wal'
            ))) `
        -Message 'SQLite WAL files must not be copied into the installation'
    Assert-True -Condition (-not (Test-Path -LiteralPath (
                Join-Path $copyDestination 'data\g2b-contracts.sqlite-shm'
            ))) `
        -Message 'SQLite SHM files must not be copied into the installation'

    $shortcutName = Get-StartShortcutName
    New-PortableShortcut `
        -ShortcutRoot $copyDestination `
        -InstallRoot $copyDestination `
        -ShortcutName $shortcutName `
        -ScriptName 'start-local-web.ps1' `
        -Description 'Start G2B Contracts local web'
    $shortcutPath = Join-Path $copyDestination $shortcutName
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $expectedScriptPath = Get-PortableToolPath `
        -InstallRoot $copyDestination `
        -ScriptName 'start-local-web.ps1'
    Assert-True -Condition ($shortcut.TargetPath -like '*\powershell.exe') `
        -Message 'Shortcut target must be Windows PowerShell'
    Assert-True -Condition ($shortcut.Arguments -eq (
            New-PowerShellFileArguments -ScriptPath $expectedScriptPath
        )) `
        -Message 'Shortcut arguments must point to the copied script'
    Assert-True -Condition ((Normalize-PathForComparison `
            -Path $shortcut.WorkingDirectory) -eq (
            Normalize-PathForComparison -Path $copyDestination
        )) `
        -Message 'Shortcut working directory must be the install root'

    $archiveDestination = Join-Path $fixtureRoot 'archive app'
    Export-TrackedApplication `
        -SourceRoot $repositoryRoot `
        -DestinationAppPath $archiveDestination
    Assert-True -Condition (Test-Path `
            -LiteralPath (Join-Path $archiveDestination 'package.json') `
            -PathType Leaf) `
        -Message 'Tracked application archive must contain package.json'
    Assert-True -Condition (-not (Test-Path `
            -LiteralPath (Join-Path $archiveDestination '.git'))) `
        -Message 'Tracked application archive must not contain .git metadata'
}
finally {
    if (($null -ne $createdReparsePoint) -and
        (Test-Path -LiteralPath $createdReparsePoint)) {
        Remove-Item -LiteralPath $createdReparsePoint -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$installerText = Get-Content -Raw -LiteralPath $installerPath
Assert-True -Condition ($installerText -notmatch '(?i)Copy-Item[^\r\n]*(sqlite|-wal|-shm)') `
    -Message 'Installer must not directly copy SQLite database or sidecar files'
Assert-True -Condition ($installerText -match 'Invoke-SqliteBackup') `
    -Message 'Installer must create the database through the SQLite backup API'
Assert-True -Condition ($installerText -match 'G2B_INSTALLER_NONINTERACTIVE') `
    -Message 'Installer must support noninteractive user-error fallback'
Assert-True -Condition ($installerText -match "-Name\s+'npm\.cmd'") `
    -Message 'Installer must resolve npm.cmd explicitly'

Write-Output 'portable_installer_tests=passed'
