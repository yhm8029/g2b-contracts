[CmdletBinding()]
param(
    [string]$SourceRoot,

    [string]$DestinationRoot = (Join-Path `
        ([System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)) `
        '나라장터 경쟁사 영업성과')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$installerMarkerName = '.g2b-portable-install.json'
$portableFolderName = '나라장터 경쟁사 영업성과'

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

function Test-ExistingDestinationCanBeRemoved {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    $markerPath = Join-Path -Path $DestinationRoot -ChildPath '.g2b-portable-install.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        return $false
    }

    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        return (-not [string]::IsNullOrWhiteSpace([string]$marker.version)) -and
            (-not [string]::IsNullOrWhiteSpace([string]$marker.installedAt)) -and
            (-not [string]::IsNullOrWhiteSpace([string]$marker.sourceCommit))
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
    $reportedRoot = [string](Invoke-Git -SourceRoot $normalizedSourceRoot -Arguments @('rev-parse', '--show-toplevel'))
    if (-not (Normalize-PathForComparison -Path $reportedRoot).Equals(
            $normalizedSourceRoot,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw "SourceRoot must be the root of a git worktree: $normalizedSourceRoot"
    }

    $worktreeRoots = @(
        Invoke-Git -SourceRoot $normalizedSourceRoot -Arguments @('worktree', 'list', '--porcelain') |
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

    $commit = [string](Invoke-Git -SourceRoot $normalizedSourceRoot -Arguments @('rev-parse', '--verify', 'HEAD'))
    if ([string]::IsNullOrWhiteSpace($commit)) {
        throw "SourceRoot does not have a committed HEAD: $normalizedSourceRoot"
    }

    return $commit.Trim()
}

function Get-ListeningProcessIds {
    $port = 5182
    $getNetTcpConnection = Get-Command -Name 'Get-NetTCPConnection' -ErrorAction SilentlyContinue
    if ($null -ne $getNetTcpConnection) {
        try {
            return @(
                Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
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
                $match = [System.Text.RegularExpressions.Regex]::Match($_.Line, $pattern)
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
    if ($destination.Equals($destinationDriveRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "DestinationRoot cannot be a filesystem root: $destination"
    }

    $source = Normalize-PathForComparison -Path $SourceRoot
    if ($destination.Equals($source, [System.StringComparison]::OrdinalIgnoreCase) -or
        (Test-PathIsDescendant -CandidatePath $source -ParentPath $destination)) {
        throw "DestinationRoot must not be SourceRoot or an ancestor of it: $destination"
    }

    $desktopPath = Normalize-PathForComparison -Path (
        [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
    )
    $expectedDefault = Normalize-PathForComparison -Path (Join-Path $desktopPath $portableFolderName)
    $defaultDestination = Normalize-PathForComparison -Path $DefaultDestinationRoot
    $isExpectedDesktopTarget = $destination.Equals(
        $expectedDefault,
        [System.StringComparison]::OrdinalIgnoreCase
    ) -and (Test-PathIsDescendant -CandidatePath $destination -ParentPath $desktopPath)

    if (-not $DestinationRootWasExplicit) {
        if ((-not $destination.Equals($defaultDestination, [System.StringComparison]::OrdinalIgnoreCase)) -or
            (-not $isExpectedDesktopTarget)) {
            throw "Default DestinationRoot must be the expected Desktop folder: $expectedDefault"
        }
    }

    if (Test-Path -LiteralPath $destination) {
        $destinationItem = Get-Item -LiteralPath $destination -Force
        if (($destinationItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "DestinationRoot cannot be a reparse point: $destination"
        }
    }

    return $destination
}

function Remove-ExistingDestination {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [string]$ValidatedDestinationRoot
    )

    if (-not (Test-Path -LiteralPath $DestinationRoot)) {
        return
    }

    $currentDestination = Normalize-PathForComparison -Path $DestinationRoot
    if (-not $currentDestination.Equals(
            $ValidatedDestinationRoot,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Refusing recursive deletion outside the validated destination boundary: $currentDestination"
    }
    if (-not (Test-ExistingDestinationCanBeRemoved -DestinationRoot $currentDestination)) {
        throw "Refusing to replace existing DestinationRoot without a valid installer marker: $currentDestination"
    }

    Remove-Item -LiteralPath $currentDestination -Recurse -Force -ErrorAction Stop
}

function Export-TrackedApplication {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$DestinationAppPath
    )

    $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) (
        'g2b-portable-' + [guid]::NewGuid().ToString('N')
    )
    $archivePath = Join-Path $temporaryDirectory 'app.zip'
    try {
        New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null
        & git.exe -C $SourceRoot archive --format=zip --output=$archivePath HEAD
        if ($LASTEXITCODE -ne 0) {
            throw 'git archive HEAD failed while exporting the portable application.'
        }

        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
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

        Expand-Archive -LiteralPath $archivePath -DestinationPath $DestinationAppPath -Force
        if (Test-Path -LiteralPath (Join-Path $DestinationAppPath '.git')) {
            throw 'The exported application contains unexpected .git metadata.'
        }
    }
    finally {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
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
    Copy-Item -LiteralPath $environmentSource -Destination (Join-Path $DestinationRoot 'app\.env.local') -Force

    $databaseSource = Join-Path $SourceRoot 'data\g2b-contracts.sqlite'
    if (-not (Test-Path -LiteralPath $databaseSource -PathType Leaf)) {
        throw "Required source database is missing: $databaseSource"
    }
    $databaseDestination = Join-Path $DestinationRoot 'data\g2b-contracts.sqlite'
    Copy-Item -LiteralPath $databaseSource -Destination $databaseDestination -Force
    foreach ($sidecarSuffix in @('-wal', '-shm')) {
        $sidecarSource = $databaseSource + $sidecarSuffix
        if (Test-Path -LiteralPath $sidecarSource -PathType Leaf) {
            Copy-Item -LiteralPath $sidecarSource -Destination ($databaseDestination + $sidecarSuffix) -Force
        }
    }

    $portableToolsSource = Join-Path $SourceRoot 'tools\portable\*.ps1'
    $portableTools = @(Get-ChildItem -Path $portableToolsSource -File -ErrorAction Stop)
    if ($portableTools.Count -eq 0) {
        throw "Required portable tools are missing: $portableToolsSource"
    }
    Copy-Item -LiteralPath $portableTools.FullName -Destination (Join-Path $DestinationRoot 'tools') -Force
}

function Invoke-NpmBuild {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppPath
    )

    $nodeCommand = Get-Command -Name 'node.exe' -ErrorAction SilentlyContinue
    $npmCommand = Get-Command -Name 'npm' -ErrorAction SilentlyContinue
    if (($null -eq $nodeCommand) -or ($null -eq $npmCommand)) {
        throw 'Both node and npm must be available on PATH to build the portable application.'
    }

    Push-Location -LiteralPath $AppPath
    try {
        & $npmCommand.Source ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed in $AppPath with exit code $LASTEXITCODE"
        }

        & $npmCommand.Source run build
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
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [string]$ShortcutName,

        [Parameter(Mandatory = $true)]
        [string]$ScriptName,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
        throw "Windows PowerShell was not found: $powerShellPath"
    }

    $scriptPath = Join-Path $DestinationRoot (Join-Path 'tools\portable' $ScriptName)
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        throw "Shortcut target script was not found: $scriptPath"
    }

    $shortcutPath = Join-Path $DestinationRoot $ShortcutName
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powerShellPath
    $shortcut.Arguments = New-PowerShellFileArguments -ScriptPath $scriptPath
    $shortcut.WorkingDirectory = $DestinationRoot
    $shortcut.IconLocation = "$powerShellPath,0"
    $shortcut.Description = $Description
    $shortcut.Save()
}

function Write-InstallMarker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [string]$SourceCommit,

        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    $marker = [ordered]@{
        version = $Version
        installedAt = (Get-Date).ToUniversalTime().ToString('o')
        sourceCommit = $SourceCommit
    }
    $marker | ConvertTo-Json | Set-Content `
        -LiteralPath (Join-Path $DestinationRoot $installerMarkerName) `
        -Encoding UTF8
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
    if (-not (Test-Path -LiteralPath $normalizedSourceRoot -PathType Container)) {
        throw "SourceRoot does not exist: $normalizedSourceRoot"
    }

    $defaultDestinationRoot = Join-Path (
        [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
    ) $portableFolderName
    $validatedDestinationRoot = Assert-SafeDestinationRoot `
        -DestinationRoot $DestinationRoot `
        -DefaultDestinationRoot $defaultDestinationRoot `
        -SourceRoot $normalizedSourceRoot `
        -DestinationRootWasExplicit $DestinationRootWasExplicit
    $sourceCommit = Get-SourceWorktreeCommit -SourceRoot $normalizedSourceRoot

    $listenerIds = @(Get-ListeningProcessIds)
    if ($listenerIds.Count -gt 0) {
        throw "Port 5182 is currently used by process ID(s) $($listenerIds -join ', '). Stop the server yourself before reinstalling; the installer does not stop processes."
    }

    Remove-ExistingDestination `
        -DestinationRoot $validatedDestinationRoot `
        -ValidatedDestinationRoot $validatedDestinationRoot
    New-Item -ItemType Directory -Path $validatedDestinationRoot -Force | Out-Null
    foreach ($directoryName in @('app', 'data', 'logs', 'tools')) {
        New-Item -ItemType Directory -Path (Join-Path $validatedDestinationRoot $directoryName) -Force | Out-Null
    }

    $appPath = Join-Path $validatedDestinationRoot 'app'
    Export-TrackedApplication -SourceRoot $normalizedSourceRoot -DestinationAppPath $appPath
    Copy-RequiredSourceFiles -SourceRoot $normalizedSourceRoot -DestinationRoot $validatedDestinationRoot
    Invoke-NpmBuild -AppPath $appPath

    $package = Get-Content -LiteralPath (Join-Path $appPath 'package.json') -Raw | ConvertFrom-Json
    $version = [string]$package.version
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw 'The exported application package.json does not contain a version.'
    }

    New-PortableShortcut `
        -DestinationRoot $validatedDestinationRoot `
        -ShortcutName '실행.lnk' `
        -ScriptName 'start-local-web.ps1' `
        -Description 'Start G2B Contracts local web'
    New-PortableShortcut `
        -DestinationRoot $validatedDestinationRoot `
        -ShortcutName '종료.lnk' `
        -ScriptName 'stop-local-web.ps1' `
        -Description 'Stop G2B Contracts local web'
    Write-InstallMarker `
        -DestinationRoot $validatedDestinationRoot `
        -SourceCommit $sourceCommit `
        -Version $version

    Write-Output "Portable desktop application installed at $validatedDestinationRoot"
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-PortableDesktopInstaller `
            -SourceRoot $SourceRoot `
            -DestinationRoot $DestinationRoot `
            -DestinationRootWasExplicit $PSBoundParameters.ContainsKey('DestinationRoot')
    }
    catch {
        Show-UserError -Message $_.Exception.Message
        exit 1
    }
}
