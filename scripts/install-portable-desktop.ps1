[CmdletBinding()]
param(
    [string]$SourceRoot,

    [string]$DestinationRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:InstallerMarkerName = '.g2b-portable-install.json'
$script:OwnershipMarkerName = '.g2b-installer-owned.json'
$script:InstallationId = 'g2b-contracts-portable-desktop-v1'

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

function Get-StartShortcutName {
    return ConvertFrom-Utf8Base64 -Value '7Iuk7ZaJLmxuaw=='
}

function Get-StopShortcutName {
    return ConvertFrom-Utf8Base64 -Value '7KKF66OMLmxuaw=='
}

function Normalize-PathForComparison {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path).Replace('/', '\')
    $rootPath = [System.IO.Path]::GetPathRoot($fullPath).Replace('/', '\')
    if ($fullPath.Length -gt $rootPath.Length) {
        return $fullPath.TrimEnd([char[]]@('\', '/'))
    }

    return $fullPath
}

function Test-PathIsDescendant {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CandidatePath,

        [Parameter(Mandatory = $true)]
        [string]$ParentPath
    )

    $candidate = Normalize-PathForComparison -Path $CandidatePath
    $parent = Normalize-PathForComparison -Path $ParentPath
    if ($candidate.Equals($parent, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }

    return $candidate.StartsWith(
        ($parent.TrimEnd([char[]]@('\', '/')) + '\'),
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Test-PathIsDirectChild {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CandidatePath,

        [Parameter(Mandatory = $true)]
        [string]$ParentPath
    )

    $candidate = Normalize-PathForComparison -Path $CandidatePath
    $parent = Normalize-PathForComparison -Path $ParentPath
    if (-not (Test-PathIsDescendant `
            -CandidatePath $candidate `
            -ParentPath $parent)) {
        return $false
    }

    $candidateParent = Normalize-PathForComparison `
        -Path (Split-Path -Parent $candidate)
    return $candidateParent.Equals(
        $parent,
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Assert-NoReparsePoints {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $pending = New-Object System.Collections.Stack
    $pending.Push((Get-Item -LiteralPath $Path -Force))
    while ($pending.Count -gt 0) {
        $item = $pending.Pop()
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing recursive operation through a reparse point: $($item.FullName)"
        }

        if ($item.PSIsContainer) {
            foreach ($child in @(Get-ChildItem `
                    -LiteralPath $item.FullName `
                    -Force `
                    -ErrorAction Stop)) {
                if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "Refusing recursive operation through a reparse point: $($child.FullName)"
                }
                if ($child.PSIsContainer) {
                    $pending.Push($child)
                }
            }
        }
    }
}

function Test-ArchiveContainsGitMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$EntryNames
    )

    foreach ($entryName in $EntryNames) {
        $normalizedEntryName = $entryName.Replace('\', '/')
        if ($normalizedEntryName -match '(^|/)\.git(/|$)') {
            return $true
        }
    }

    return $false
}

function Test-InstallMarker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallRoot,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedDestinationRoot
    )

    $markerPath = Join-Path $InstallRoot $script:InstallerMarkerName
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        return $false
    }

    try {
        $markerItem = Get-Item -LiteralPath $markerPath -Force
        if (($markerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            return $false
        }

        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.installationId -cne $script:InstallationId) {
            return $false
        }

        $markerDestination = Normalize-PathForComparison `
            -Path ([string]$marker.destinationRoot)
        $expectedDestination = Normalize-PathForComparison `
            -Path $ExpectedDestinationRoot
        if (-not $markerDestination.Equals(
                $expectedDestination,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return $false
        }

        if ([string]$marker.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') {
            return $false
        }
        if ([string]$marker.sourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
            return $false
        }

        $installedAt = [System.DateTimeOffset]::MinValue
        if (-not [System.DateTimeOffset]::TryParse(
                [string]$marker.installedAt,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::RoundtripKind,
                [ref]$installedAt
            )) {
            return $false
        }

        return $true
    }
    catch {
        return $false
    }
}

function Test-ExistingDestinationCanBeRemoved {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    if (-not (Test-InstallMarker `
            -InstallRoot $DestinationRoot `
            -ExpectedDestinationRoot $DestinationRoot)) {
        return $false
    }

    try {
        Assert-NoReparsePoints -Path $DestinationRoot
        return $true
    }
    catch {
        return $false
    }
}

function New-PowerShellFileArguments {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath
    )

    if ($ScriptPath.IndexOf('"') -ge 0) {
        throw 'Shortcut script paths cannot contain a double quote.'
    }

    return '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $ScriptPath
}

function Get-PortableToolPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallRoot,

        [Parameter(Mandatory = $true)]
        [string]$ScriptName
    )

    if ([System.IO.Path]::GetFileName($ScriptName) -ne $ScriptName) {
        throw "Portable script name must be a file name: $ScriptName"
    }

    return Join-Path $InstallRoot (Join-Path 'tools' $ScriptName)
}

function New-InstallerOwnedSiblingPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [ValidateSet('installing', 'backup')]
        [string]$Purpose
    )

    $destination = Normalize-PathForComparison -Path $DestinationRoot
    $parent = Split-Path -Parent $destination
    $leafName = Split-Path -Leaf $destination
    $siblingName = '{0}.{1}-{2}' -f `
        $leafName, `
        $Purpose, `
        [guid]::NewGuid().ToString('N')
    return Normalize-PathForComparison -Path (Join-Path $parent $siblingName)
}

function New-InstallerOwnedTemporaryPath {
    $parent = Normalize-PathForComparison -Path ([System.IO.Path]::GetTempPath())
    $leafName = 'g2b-portable.temp-{0}' -f [guid]::NewGuid().ToString('N')
    return Normalize-PathForComparison -Path (Join-Path $parent $leafName)
}

function Get-OwnershipTokenFromPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $leafName = Split-Path -Leaf (Normalize-PathForComparison -Path $Path)
    $match = [System.Text.RegularExpressions.Regex]::Match(
        $leafName,
        '([0-9a-f]{32})$'
    )
    if (-not $match.Success) {
        return ''
    }

    return $match.Groups[1].Value
}

function Test-InstallerOwnedPathShape {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedParent,

        [Parameter(Mandatory = $true)]
        [ValidateSet('installing', 'backup', 'temporary')]
        [string]$Purpose,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    $candidate = Normalize-PathForComparison -Path $Path
    $parent = Normalize-PathForComparison -Path $ExpectedParent
    if (-not (Test-PathIsDirectChild `
            -CandidatePath $candidate `
            -ParentPath $parent)) {
        return $false
    }

    $candidateLeaf = Split-Path -Leaf $candidate
    if ($Purpose -eq 'temporary') {
        return $candidateLeaf -match '^g2b-portable\.temp-[0-9a-f]{32}$'
    }

    $destinationLeaf = [System.Text.RegularExpressions.Regex]::Escape(
        (Split-Path -Leaf (Normalize-PathForComparison -Path $DestinationRoot))
    )
    return $candidateLeaf -match (
        '^{0}\.{1}-[0-9a-f]{{32}}$' -f $destinationLeaf, $Purpose
    )
}

function Write-OwnershipMarker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedParent,

        [Parameter(Mandatory = $true)]
        [ValidateSet('installing', 'backup', 'temporary')]
        [string]$Purpose,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    $ownedPath = Normalize-PathForComparison -Path $Path
    $marker = [ordered]@{
        installationId = $script:InstallationId
        ownershipToken = Get-OwnershipTokenFromPath -Path $ownedPath
        ownedPath = $ownedPath
        expectedParent = Normalize-PathForComparison -Path $ExpectedParent
        purpose = $Purpose
        destinationRoot = Normalize-PathForComparison -Path $DestinationRoot
    }
    $marker | ConvertTo-Json | Set-Content `
        -LiteralPath (Join-Path $ownedPath $script:OwnershipMarkerName) `
        -Encoding UTF8
}

function Initialize-InstallerOwnedDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedParent,

        [Parameter(Mandatory = $true)]
        [ValidateSet('installing', 'backup', 'temporary')]
        [string]$Purpose,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    if (-not (Test-InstallerOwnedPathShape `
            -Path $Path `
            -ExpectedParent $ExpectedParent `
            -Purpose $Purpose `
            -DestinationRoot $DestinationRoot)) {
        throw "Refusing to initialize an unexpected installer-owned path: $Path"
    }

    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    Assert-NoReparsePoints -Path $Path
    Write-OwnershipMarker `
        -Path $Path `
        -ExpectedParent $ExpectedParent `
        -Purpose $Purpose `
        -DestinationRoot $DestinationRoot
}

function Test-InstallerOwnedDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedPath,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedParent,

        [Parameter(Mandatory = $true)]
        [ValidateSet('installing', 'backup', 'temporary')]
        [string]$Purpose,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return $false
    }

    try {
        $candidate = Normalize-PathForComparison -Path $Path
        $expected = Normalize-PathForComparison -Path $ExpectedPath
        if (-not $candidate.Equals(
                $expected,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return $false
        }
        if (-not (Test-InstallerOwnedPathShape `
                -Path $candidate `
                -ExpectedParent $ExpectedParent `
                -Purpose $Purpose `
                -DestinationRoot $DestinationRoot)) {
            return $false
        }

        $markerPath = Join-Path $candidate $script:OwnershipMarkerName
        if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
            return $false
        }
        $markerItem = Get-Item -LiteralPath $markerPath -Force
        if (($markerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            return $false
        }

        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.installationId -cne $script:InstallationId) {
            return $false
        }
        if ([string]$marker.ownershipToken -cne (
                Get-OwnershipTokenFromPath -Path $candidate
            )) {
            return $false
        }
        if (-not (Normalize-PathForComparison -Path ([string]$marker.ownedPath)).Equals(
                $candidate,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return $false
        }
        if (-not (Normalize-PathForComparison `
                -Path ([string]$marker.expectedParent)).Equals(
                (Normalize-PathForComparison -Path $ExpectedParent),
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return $false
        }
        if ([string]$marker.purpose -cne $Purpose) {
            return $false
        }
        if (-not (Normalize-PathForComparison `
                -Path ([string]$marker.destinationRoot)).Equals(
                (Normalize-PathForComparison -Path $DestinationRoot),
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return $false
        }

        Assert-NoReparsePoints -Path $candidate
        return $true
    }
    catch {
        return $false
    }
}

function Remove-InstallerOwnedDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedPath,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedParent,

        [Parameter(Mandatory = $true)]
        [ValidateSet('installing', 'backup', 'temporary')]
        [string]$Purpose,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    if (-not (Test-InstallerOwnedDirectory `
            -Path $Path `
            -ExpectedPath $ExpectedPath `
            -ExpectedParent $ExpectedParent `
            -Purpose $Purpose `
            -DestinationRoot $DestinationRoot)) {
        throw "Refusing cleanup without exact installer ownership: $Path"
    }

    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}

function Show-UserError {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $forceNonInteractive = [System.Environment]::GetEnvironmentVariable(
        'G2B_INSTALLER_NONINTERACTIVE'
    ) -eq '1'
    if ([System.Environment]::UserInteractive -and (-not $forceNonInteractive)) {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
            [void][System.Windows.Forms.MessageBox]::Show(
                $Message,
                'G2B Contracts Portable Installer',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
        catch {
        }
    }

    Write-Error -Message $Message -ErrorAction Continue
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & git.exe -C $SourceRoot @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $details = ($output | Out-String).Trim()
        throw "git $($Arguments -join ' ') failed. $details"
    }

    return @($output)
}

function Get-SourceWorktreeCommit {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot
    )

    if (-not (Get-Command -Name git.exe -ErrorAction SilentlyContinue)) {
        throw 'Git is required to create the portable application archive.'
    }

    $normalizedSourceRoot = Normalize-PathForComparison -Path $SourceRoot
    $reportedRoot = [string](Invoke-Git `
        -SourceRoot $normalizedSourceRoot `
        -Arguments @('rev-parse', '--show-toplevel'))
    if (-not (Normalize-PathForComparison -Path $reportedRoot).Equals(
            $normalizedSourceRoot,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw "SourceRoot must be the root of a git worktree: $normalizedSourceRoot"
    }

    $worktreeRoots = @(
        Invoke-Git `
            -SourceRoot $normalizedSourceRoot `
            -Arguments @('worktree', 'list', '--porcelain') |
            Where-Object { $_ -like 'worktree *' } |
            ForEach-Object { $_.Substring('worktree '.Length) }
    )
    $isWorktreeRoot = $false
    foreach ($worktreeRoot in $worktreeRoots) {
        if ((Normalize-PathForComparison -Path $worktreeRoot).Equals(
                $normalizedSourceRoot,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            $isWorktreeRoot = $true
            break
        }
    }
    if (-not $isWorktreeRoot) {
        throw "SourceRoot is not registered as a git worktree: $normalizedSourceRoot"
    }

    $commit = [string](Invoke-Git `
        -SourceRoot $normalizedSourceRoot `
        -Arguments @('rev-parse', '--verify', 'HEAD'))
    if ($commit -notmatch '^[0-9a-fA-F]{40}$') {
        throw "SourceRoot does not have a valid committed HEAD: $normalizedSourceRoot"
    }

    return $commit.Trim()
}

function Get-ListeningProcessIds {
    $port = 5182
    $getNetTcpConnection = Get-Command `
        -Name 'Get-NetTCPConnection' `
        -ErrorAction SilentlyContinue
    if ($null -ne $getNetTcpConnection) {
        try {
            return @(
                Get-NetTCPConnection `
                    -LocalPort $port `
                    -State Listen `
                    -ErrorAction Stop |
                    Select-Object -ExpandProperty OwningProcess -Unique
            )
        }
        catch {
        }
    }

    $pattern = '^\s*TCP\s+\S+:5182\s+\S+\s+LISTENING\s+(\d+)\s*$'
    return @(
        netstat.exe -ano -p tcp 2>$null |
            Select-String -Pattern $pattern |
            ForEach-Object {
                $match = [System.Text.RegularExpressions.Regex]::Match(
                    $_.Line,
                    $pattern
                )
                if ($match.Success) {
                    [int]$match.Groups[1].Value
                }
            } |
            Sort-Object -Unique
    )
}

function Assert-SafeDestinationRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [string]$DefaultDestinationRoot,

        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [bool]$DestinationRootWasExplicit
    )

    $destination = Normalize-PathForComparison -Path $DestinationRoot
    $destinationDriveRoot = [System.IO.Path]::GetPathRoot($destination)
    if ($destination.Equals(
            $destinationDriveRoot,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw "DestinationRoot cannot be a filesystem root: $destination"
    }

    $source = Normalize-PathForComparison -Path $SourceRoot
    if ($destination.Equals(
            $source,
            [System.StringComparison]::OrdinalIgnoreCase
        ) -or (Test-PathIsDescendant `
            -CandidatePath $source `
            -ParentPath $destination)) {
        throw "DestinationRoot must not be SourceRoot or an ancestor of it: $destination"
    }

    $desktopPath = Normalize-PathForComparison -Path (
        [System.Environment]::GetFolderPath(
            [System.Environment+SpecialFolder]::Desktop
        )
    )
    $expectedDefault = Normalize-PathForComparison `
        -Path (Join-Path $desktopPath (Get-PortableFolderName))
    $defaultDestination = Normalize-PathForComparison -Path $DefaultDestinationRoot
    $isExpectedDesktopTarget = $destination.Equals(
        $expectedDefault,
        [System.StringComparison]::OrdinalIgnoreCase
    ) -and (Test-PathIsDescendant `
        -CandidatePath $destination `
        -ParentPath $desktopPath)

    if (-not $DestinationRootWasExplicit) {
        if ((-not $destination.Equals(
                    $defaultDestination,
                    [System.StringComparison]::OrdinalIgnoreCase
                )) -or (-not $isExpectedDesktopTarget)) {
            throw "Default DestinationRoot must be the expected Desktop folder: $expectedDefault"
        }
    }

    if (Test-Path -LiteralPath $destination) {
        Assert-NoReparsePoints -Path $destination
    }

    return $destination
}

function Export-TrackedApplication {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$DestinationAppPath
    )

    $temporaryDirectory = New-InstallerOwnedTemporaryPath
    $temporaryParent = Normalize-PathForComparison `
        -Path ([System.IO.Path]::GetTempPath())
    $archivePath = Join-Path $temporaryDirectory 'app.zip'
    try {
        Initialize-InstallerOwnedDirectory `
            -Path $temporaryDirectory `
            -ExpectedParent $temporaryParent `
            -Purpose 'temporary' `
            -DestinationRoot $DestinationAppPath
        & git.exe -C $SourceRoot archive --format=zip --output=$archivePath HEAD
        if ($LASTEXITCODE -ne 0) {
            throw 'git archive HEAD failed while exporting the portable application.'
        }

        Add-Type `
            -AssemblyName System.IO.Compression.FileSystem `
            -ErrorAction SilentlyContinue
        $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
        try {
            $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
            if (Test-ArchiveContainsGitMetadata -EntryNames $entryNames) {
                throw 'The tracked application archive unexpectedly contains .git metadata.'
            }
        }
        finally {
            $archive.Dispose()
        }

        Expand-Archive `
            -LiteralPath $archivePath `
            -DestinationPath $DestinationAppPath `
            -Force
        if (Test-Path -LiteralPath (Join-Path $DestinationAppPath '.git')) {
            throw 'The exported application contains unexpected .git metadata.'
        }
    }
    finally {
        Remove-InstallerOwnedDirectory `
            -Path $temporaryDirectory `
            -ExpectedPath $temporaryDirectory `
            -ExpectedParent $temporaryParent `
            -Purpose 'temporary' `
            -DestinationRoot $DestinationAppPath
    }
}

function Invoke-SqliteBackup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$DatabaseSource,

        [Parameter(Mandatory = $true)]
        [string]$DatabaseDestination
    )

    $nodeCommand = Get-Command `
        -Name 'node.exe' `
        -CommandType Application `
        -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw 'Node is required to create the SQLite backup.'
    }
    if (-not (Test-Path -LiteralPath $DatabaseSource -PathType Leaf)) {
        throw "Required source database is missing: $DatabaseSource"
    }
    if ((Normalize-PathForComparison -Path $DatabaseSource).Equals(
            (Normalize-PathForComparison -Path $DatabaseDestination),
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw 'SQLite backup source and destination must be different.'
    }

    $backupScript = Join-Path $SourceRoot 'scripts\backup-sqlite.cjs'
    if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) {
        throw "SQLite backup helper is missing: $backupScript"
    }
    $betterSqlitePackage = Join-Path `
        $SourceRoot `
        'node_modules\better-sqlite3\package.json'
    if (-not (Test-Path -LiteralPath $betterSqlitePackage -PathType Leaf)) {
        throw "better-sqlite3 is not installed in SourceRoot: $SourceRoot"
    }
    if (Test-Path -LiteralPath $DatabaseDestination) {
        throw "SQLite backup destination already exists: $DatabaseDestination"
    }

    $databaseDestinationParent = Split-Path -Parent $DatabaseDestination
    if (-not (Test-Path -LiteralPath $databaseDestinationParent -PathType Container)) {
        New-Item `
            -ItemType Directory `
            -Path $databaseDestinationParent `
            -Force | Out-Null
    }

    Push-Location -LiteralPath $SourceRoot
    try {
        $output = & $nodeCommand.Path `
            $backupScript `
            $DatabaseSource `
            $DatabaseDestination 2>&1
        if ($LASTEXITCODE -ne 0) {
            $details = ($output | Out-String).Trim()
            throw "SQLite backup failed with exit code $LASTEXITCODE. $details"
        }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $DatabaseDestination -PathType Leaf)) {
        throw "SQLite backup did not create its destination: $DatabaseDestination"
    }
}

function Copy-RequiredSourceFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    $environmentSource = Join-Path $SourceRoot '.env.local'
    if (-not (Test-Path -LiteralPath $environmentSource -PathType Leaf)) {
        throw "Required source environment file is missing: $environmentSource"
    }
    Copy-Item `
        -LiteralPath $environmentSource `
        -Destination (Join-Path $DestinationRoot 'app\.env.local') `
        -Force

    $databaseSource = Join-Path $SourceRoot 'data\g2b-contracts.sqlite'
    $databaseDestination = Join-Path `
        $DestinationRoot `
        'data\g2b-contracts.sqlite'
    Invoke-SqliteBackup `
        -SourceRoot $SourceRoot `
        -DatabaseSource $databaseSource `
        -DatabaseDestination $databaseDestination

    $portableToolsSource = Join-Path $SourceRoot 'tools\portable\*.ps1'
    $portableTools = @(Get-ChildItem `
        -Path $portableToolsSource `
        -File `
        -ErrorAction Stop)
    if ($portableTools.Count -eq 0) {
        throw "Required portable tools are missing: $portableToolsSource"
    }
    foreach ($portableTool in $portableTools) {
        $portableToolDestination = Get-PortableToolPath `
            -InstallRoot $DestinationRoot `
            -ScriptName $portableTool.Name
        Copy-Item `
            -LiteralPath $portableTool.FullName `
            -Destination $portableToolDestination `
            -Force
    }
}

function Invoke-NpmBuild {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppPath
    )

    $nodeCommand = Get-Command `
        -Name 'node.exe' `
        -CommandType Application `
        -ErrorAction SilentlyContinue
    $npmCommand = Get-Command `
        -Name 'npm.cmd' `
        -CommandType Application `
        -ErrorAction SilentlyContinue
    if (($null -eq $nodeCommand) -or ($null -eq $npmCommand)) {
        throw 'Both node and npm must be available on PATH to build the portable application.'
    }

    Push-Location -LiteralPath $AppPath
    try {
        & $npmCommand.Path ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed in $AppPath with exit code $LASTEXITCODE"
        }

        & $npmCommand.Path run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed in $AppPath with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function New-PortableShortcut {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ShortcutRoot,

        [Parameter(Mandatory = $true)]
        [string]$InstallRoot,

        [Parameter(Mandatory = $true)]
        [string]$ShortcutName,

        [Parameter(Mandatory = $true)]
        [string]$ScriptName,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $powerShellPath = Join-Path `
        $env:SystemRoot `
        'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
        throw "Windows PowerShell was not found: $powerShellPath"
    }

    $copiedScriptPath = Get-PortableToolPath `
        -InstallRoot $ShortcutRoot `
        -ScriptName $ScriptName
    if (-not (Test-Path -LiteralPath $copiedScriptPath -PathType Leaf)) {
        throw "Shortcut source script was not found: $copiedScriptPath"
    }

    $scriptPath = Get-PortableToolPath `
        -InstallRoot $InstallRoot `
        -ScriptName $ScriptName
    $shortcutPath = Join-Path $ShortcutRoot $ShortcutName
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powerShellPath
    $shortcut.Arguments = New-PowerShellFileArguments -ScriptPath $scriptPath
    $shortcut.WorkingDirectory = $InstallRoot
    $shortcut.IconLocation = "$powerShellPath,0"
    $shortcut.Description = $Description
    $shortcut.Save()
}

function Write-InstallMarker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallRoot,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [string]$SourceCommit,

        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    if ($SourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
        throw "Invalid source commit for install marker: $SourceCommit"
    }
    if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') {
        throw "Invalid package version for install marker: $Version"
    }

    $marker = [ordered]@{
        installationId = $script:InstallationId
        destinationRoot = Normalize-PathForComparison -Path $DestinationRoot
        version = $Version
        installedAt = (Get-Date).ToUniversalTime().ToString('o')
        sourceCommit = $SourceCommit
    }
    $marker | ConvertTo-Json | Set-Content `
        -LiteralPath (Join-Path $InstallRoot $script:InstallerMarkerName) `
        -Encoding UTF8
}

function Remove-OwnershipMarker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DirectoryPath
    )

    $markerPath = Join-Path $DirectoryPath $script:OwnershipMarkerName
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw "Installer ownership marker is missing: $markerPath"
    }
    $markerItem = Get-Item -LiteralPath $markerPath -Force
    if (($markerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Installer ownership marker cannot be a reparse point: $markerPath"
    }
    Remove-Item -LiteralPath $markerPath -Force -ErrorAction Stop
}

function Complete-StagedInstallation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StagingRoot,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    $destinationParent = Normalize-PathForComparison `
        -Path (Split-Path -Parent $DestinationRoot)
    if (-not (Test-InstallerOwnedDirectory `
            -Path $StagingRoot `
            -ExpectedPath $StagingRoot `
            -ExpectedParent $destinationParent `
            -Purpose 'installing' `
            -DestinationRoot $DestinationRoot)) {
        throw "Refusing to install from an unowned staging directory: $StagingRoot"
    }
    if (-not (Test-InstallMarker `
            -InstallRoot $StagingRoot `
            -ExpectedDestinationRoot $DestinationRoot)) {
        throw "Refusing to install from staging without a valid install marker: $StagingRoot"
    }

    $backupRoot = $null
    if (Test-Path -LiteralPath $DestinationRoot) {
        if (-not (Test-ExistingDestinationCanBeRemoved `
                -DestinationRoot $DestinationRoot)) {
            throw "Refusing to replace existing DestinationRoot without a valid installer marker: $DestinationRoot"
        }

        $backupRoot = New-InstallerOwnedSiblingPath `
            -DestinationRoot $DestinationRoot `
            -Purpose 'backup'
        Move-Item `
            -LiteralPath $DestinationRoot `
            -Destination $backupRoot `
            -ErrorAction Stop
        Initialize-InstallerOwnedDirectory `
            -Path $backupRoot `
            -ExpectedParent $destinationParent `
            -Purpose 'backup' `
            -DestinationRoot $DestinationRoot
    }

    try {
        Move-Item `
            -LiteralPath $StagingRoot `
            -Destination $DestinationRoot `
            -ErrorAction Stop
        Remove-OwnershipMarker -DirectoryPath $DestinationRoot
    }
    catch {
        $swapError = $_
        if (($null -ne $backupRoot) -and
            (Test-Path -LiteralPath $backupRoot) -and
            (-not (Test-Path -LiteralPath $DestinationRoot))) {
            try {
                if (-not (Test-InstallMarker `
                        -InstallRoot $backupRoot `
                        -ExpectedDestinationRoot $DestinationRoot)) {
                    throw "Backup install marker is invalid: $backupRoot"
                }
                if (-not (Test-InstallerOwnedDirectory `
                        -Path $backupRoot `
                        -ExpectedPath $backupRoot `
                        -ExpectedParent $destinationParent `
                        -Purpose 'backup' `
                        -DestinationRoot $DestinationRoot)) {
                    throw "Backup ownership marker is invalid: $backupRoot"
                }
                Remove-OwnershipMarker -DirectoryPath $backupRoot
                Move-Item `
                    -LiteralPath $backupRoot `
                    -Destination $DestinationRoot `
                    -ErrorAction Stop
            }
            catch {
                throw "Installing the staged application failed and restoring the previous installation also failed. Previous installation remains at $backupRoot. Swap error: $($swapError.Exception.Message). Restore error: $($_.Exception.Message)"
            }
        }

        throw $swapError
    }

    if (($null -ne $backupRoot) -and
        (Test-Path -LiteralPath $backupRoot)) {
        if (-not (Test-InstallMarker `
                -InstallRoot $backupRoot `
                -ExpectedDestinationRoot $DestinationRoot)) {
            throw "Refusing to delete backup with an invalid install marker: $backupRoot"
        }
        Remove-InstallerOwnedDirectory `
            -Path $backupRoot `
            -ExpectedPath $backupRoot `
            -ExpectedParent $destinationParent `
            -Purpose 'backup' `
            -DestinationRoot $DestinationRoot
    }
}

function Invoke-PortableDesktopInstaller {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [bool]$DestinationRootWasExplicit
    )

    $normalizedSourceRoot = Normalize-PathForComparison -Path $SourceRoot
    if (-not (Test-Path `
            -LiteralPath $normalizedSourceRoot `
            -PathType Container)) {
        throw "SourceRoot does not exist: $normalizedSourceRoot"
    }

    $defaultDestinationRoot = Join-Path (
        [System.Environment]::GetFolderPath(
            [System.Environment+SpecialFolder]::Desktop
        )
    ) (Get-PortableFolderName)
    $validatedDestinationRoot = Assert-SafeDestinationRoot `
        -DestinationRoot $DestinationRoot `
        -DefaultDestinationRoot $defaultDestinationRoot `
        -SourceRoot $normalizedSourceRoot `
        -DestinationRootWasExplicit $DestinationRootWasExplicit
    $sourceCommit = Get-SourceWorktreeCommit `
        -SourceRoot $normalizedSourceRoot

    $listenerIds = @(Get-ListeningProcessIds)
    if ($listenerIds.Count -gt 0) {
        throw "Port 5182 is currently used by process ID(s) $($listenerIds -join ', '). Stop the server yourself before reinstalling; the installer does not stop processes."
    }

    if ((Test-Path -LiteralPath $validatedDestinationRoot) -and
        (-not (Test-ExistingDestinationCanBeRemoved `
            -DestinationRoot $validatedDestinationRoot))) {
        throw "Refusing to replace existing DestinationRoot without a valid installer marker: $validatedDestinationRoot"
    }

    $destinationParent = Normalize-PathForComparison `
        -Path (Split-Path -Parent $validatedDestinationRoot)
    $stagingRoot = New-InstallerOwnedSiblingPath `
        -DestinationRoot $validatedDestinationRoot `
        -Purpose 'installing'
    try {
        Initialize-InstallerOwnedDirectory `
            -Path $stagingRoot `
            -ExpectedParent $destinationParent `
            -Purpose 'installing' `
            -DestinationRoot $validatedDestinationRoot
        foreach ($directoryName in @('app', 'data', 'logs', 'tools')) {
            New-Item `
                -ItemType Directory `
                -Path (Join-Path $stagingRoot $directoryName) `
                -Force | Out-Null
        }

        $appPath = Join-Path $stagingRoot 'app'
        Export-TrackedApplication `
            -SourceRoot $normalizedSourceRoot `
            -DestinationAppPath $appPath
        Copy-RequiredSourceFiles `
            -SourceRoot $normalizedSourceRoot `
            -DestinationRoot $stagingRoot
        Invoke-NpmBuild -AppPath $appPath

        $package = Get-Content `
            -LiteralPath (Join-Path $appPath 'package.json') `
            -Raw | ConvertFrom-Json
        $version = [string]$package.version
        if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') {
            throw 'The exported application package.json does not contain a valid version.'
        }

        New-PortableShortcut `
            -ShortcutRoot $stagingRoot `
            -InstallRoot $validatedDestinationRoot `
            -ShortcutName (Get-StartShortcutName) `
            -ScriptName 'start-local-web.ps1' `
            -Description 'Start G2B Contracts local web'
        New-PortableShortcut `
            -ShortcutRoot $stagingRoot `
            -InstallRoot $validatedDestinationRoot `
            -ShortcutName (Get-StopShortcutName) `
            -ScriptName 'stop-local-web.ps1' `
            -Description 'Stop G2B Contracts local web'
        Write-InstallMarker `
            -InstallRoot $stagingRoot `
            -DestinationRoot $validatedDestinationRoot `
            -SourceCommit $sourceCommit `
            -Version $version
        Complete-StagedInstallation `
            -StagingRoot $stagingRoot `
            -DestinationRoot $validatedDestinationRoot
    }
    finally {
        Remove-InstallerOwnedDirectory `
            -Path $stagingRoot `
            -ExpectedPath $stagingRoot `
            -ExpectedParent $destinationParent `
            -Purpose 'installing' `
            -DestinationRoot $validatedDestinationRoot
    }

    Write-Output "Portable desktop application installed at $validatedDestinationRoot"
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
            $SourceRoot = Split-Path -Parent (
                Split-Path -Parent $MyInvocation.MyCommand.Path
            )
        }
        if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
            $DestinationRoot = Join-Path (
                [System.Environment]::GetFolderPath(
                    [System.Environment+SpecialFolder]::Desktop
                )
            ) (Get-PortableFolderName)
        }

        Invoke-PortableDesktopInstaller `
            -SourceRoot $SourceRoot `
            -DestinationRoot $DestinationRoot `
            -DestinationRootWasExplicit (
                $PSBoundParameters.ContainsKey('DestinationRoot')
            )
    }
    catch {
        Show-UserError -Message $_.Exception.Message
        exit 1
    }
}
