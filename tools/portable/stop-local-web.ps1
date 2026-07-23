[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$port = 5182
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Definition
$installRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $scriptDirectory -ChildPath '..'))
$appPath = [System.IO.Path]::GetFullPath((Join-Path -Path $installRoot -ChildPath 'app'))
$runtimePath = [System.IO.Path]::GetFullPath((Join-Path -Path $installRoot -ChildPath 'runtime'))
$metadataPath = Join-Path -Path $runtimePath -ChildPath 'server.json'

function Show-UserMessage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Error', 'Warning')]
        [string]$Kind
    )

    $messageWasShown = $false
    $forceNonInteractive = [System.Environment]::GetEnvironmentVariable(
        'G2B_LAUNCHER_NONINTERACTIVE'
    ) -eq '1'
    if ([System.Environment]::UserInteractive -and (-not $forceNonInteractive)) {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
            $icon = if ($Kind -eq 'Error') {
                [System.Windows.Forms.MessageBoxIcon]::Error
            }
            else {
                [System.Windows.Forms.MessageBoxIcon]::Warning
            }
            [void][System.Windows.Forms.MessageBox]::Show(
                $Message,
                'G2B Contracts Local Web',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                $icon
            )
            $messageWasShown = $true
        }
        catch {
            $messageWasShown = $false
        }
    }

    if ($Kind -eq 'Error') {
        Write-Error -Message $Message -ErrorAction Continue
    }
    elseif (-not $messageWasShown) {
        Write-Warning -Message $Message
    }
}

function Normalize-PathForComparison {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\').Replace('/', '\')
}

function Test-CommandLineContainsExactPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandLine,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedPath
    )

    $normalizedCommandLine = $CommandLine.Replace('/', '\')
    $normalizedExpectedPath = Normalize-PathForComparison -Path $ExpectedPath
    $searchIndex = 0

    while ($searchIndex -lt $normalizedCommandLine.Length) {
        $matchIndex = $normalizedCommandLine.IndexOf(
            $normalizedExpectedPath,
            $searchIndex,
            [System.StringComparison]::OrdinalIgnoreCase
        )
        if ($matchIndex -lt 0) {
            return $false
        }

        $beforeIsBoundary = $matchIndex -eq 0
        if (-not $beforeIsBoundary) {
            $before = $normalizedCommandLine[$matchIndex - 1]
            $beforeIsBoundary = [char]::IsWhiteSpace($before) -or
                ($before -eq '"') -or
                ($before -eq [char]39) -or
                ($before -eq '=')
        }

        $afterIndex = $matchIndex + $normalizedExpectedPath.Length
        $afterIsBoundary = $afterIndex -eq $normalizedCommandLine.Length
        if (-not $afterIsBoundary) {
            $after = $normalizedCommandLine[$afterIndex]
            $afterIsBoundary = [char]::IsWhiteSpace($after) -or
                ($after -eq '\') -or
                ($after -eq '"') -or
                ($after -eq [char]39)
        }

        if ($beforeIsBoundary -and $afterIsBoundary) {
            return $true
        }

        $searchIndex = $matchIndex + 1
    }

    return $false
}

function Test-MetadataMatchesListener {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Metadata,

        [Parameter(Mandatory = $true)]
        [object]$Listener,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedAppPath
    )

    try {
        if ([string]::IsNullOrWhiteSpace([string]$Metadata.ListenerCreationTimeUtc) -or
            [string]::IsNullOrWhiteSpace([string]$Listener.CreationTimeUtc)) {
            return $false
        }

        $metadataAppPath = Normalize-PathForComparison -Path ([string]$Metadata.AppPath)
        $expectedNormalizedAppPath = Normalize-PathForComparison -Path $ExpectedAppPath
        if (-not $metadataAppPath.Equals(
                $expectedNormalizedAppPath,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return $false
        }

        if ([int]$Metadata.ListenerProcessId -ne [int]$Listener.Id) {
            return $false
        }

        return ([string]$Metadata.ListenerCreationTimeUtc).Equals(
            [string]$Listener.CreationTimeUtc,
            [System.StringComparison]::Ordinal
        )
    }
    catch {
        return $false
    }
}

$normalizedAppPath = Normalize-PathForComparison -Path $appPath

function Get-ListeningProcessIds {
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
    $ids = @(
        netstat.exe -ano -p tcp 2>$null |
            Select-String -Pattern $pattern |
            ForEach-Object {
                $match = [System.Text.RegularExpressions.Regex]::Match($_.Line, $pattern)
                if ($match.Success) {
                    [int]$match.Groups[1].Value
                }
            }
    )
    return @($ids | Sort-Object -Unique)
}

function Get-ProcessDetails {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    try {
        $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    }
    catch {
        return $null
    }

    if ($null -eq $process) {
        return $null
    }

    $creationTimeUtc = ''
    if ($null -ne $process.CreationDate) {
        $creationTimeUtc = ([datetime]$process.CreationDate).ToUniversalTime().ToString('o')
    }

    return [pscustomobject]@{
        Id = [int]$process.ProcessId
        ParentId = [int]$process.ParentProcessId
        CommandLine = [string]$process.CommandLine
        CreationTimeUtc = $creationTimeUtc
    }
}

function Get-ProcessChain {
    param(
        [Parameter(Mandatory = $true)]
        [int]$StartingProcessId
    )

    $chain = New-Object 'System.Collections.Generic.List[object]'
    $visited = @{}
    $currentProcessId = $StartingProcessId
    $depth = 0

    while (($currentProcessId -gt 0) -and (-not $visited.ContainsKey([string]$currentProcessId))) {
        $visited[[string]$currentProcessId] = $true
        $details = Get-ProcessDetails -ProcessId $currentProcessId
        if ($null -eq $details) {
            break
        }

        $details | Add-Member -NotePropertyName Depth -NotePropertyValue $depth
        [void]$chain.Add($details)

        if (($details.ParentId -le 0) -or ($details.ParentId -eq $details.Id)) {
            break
        }

        $currentProcessId = $details.ParentId
        $depth++
    }

    return @($chain.ToArray())
}

try {
    $listenerProcessIds = @(Get-ListeningProcessIds)
    if ($listenerProcessIds.Count -eq 0) {
        Write-Output "No listener is using port $port. Nothing to stop."
        exit 0
    }

    $metadata = $null
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        try {
            $metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
        }
        catch {
            $metadata = $null
        }
    }

    if ($null -eq $metadata) {
        Show-UserMessage `
            -Message "Port $port has a listener, but valid portable server metadata was not found. No process was stopped." `
            -Kind 'Warning'
        exit 0
    }

    $portableTargets = @{}
    $unrelatedProcessIds = New-Object 'System.Collections.Generic.List[string]'

    foreach ($listenerProcessId in $listenerProcessIds) {
        $chain = @(Get-ProcessChain -StartingProcessId ([int]$listenerProcessId))
        if (($chain.Count -eq 0) -or
            (-not (Test-MetadataMatchesListener `
                    -Metadata $metadata `
                    -Listener $chain[0] `
                    -ExpectedAppPath $normalizedAppPath))) {
            [void]$unrelatedProcessIds.Add([string]$listenerProcessId)
            continue
        }

        $portableMatches = @(
            $chain | Where-Object {
                Test-CommandLineContainsExactPath `
                    -CommandLine $_.CommandLine `
                    -ExpectedPath $normalizedAppPath
            }
        )

        if ($portableMatches.Count -eq 0) {
            [void]$unrelatedProcessIds.Add([string]$listenerProcessId)
            continue
        }

        $portableBoundaryDepth = ($portableMatches | Measure-Object -Property Depth -Maximum).Maximum
        foreach ($process in ($chain | Where-Object { $_.Depth -le $portableBoundaryDepth })) {
            if (-not $portableTargets.ContainsKey([string]$process.Id)) {
                $portableTargets[[string]$process.Id] = $process
            }
        }
    }

    if ($portableTargets.Count -eq 0) {
        $unrelatedText = ($unrelatedProcessIds -join ', ')
        Show-UserMessage `
            -Message "Port $port is used by unrelated process ID(s) $unrelatedText. No process was stopped." `
            -Kind 'Warning'
        exit 0
    }

    $targets = @($portableTargets.Values | Sort-Object -Property Depth)
    foreach ($target in $targets) {
        Stop-Process -Id $target.Id -Force -ErrorAction Stop
        Write-Output "Stopped portable local web process $($target.Id)."
    }
    Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue

    if ($unrelatedProcessIds.Count -gt 0) {
        $unrelatedText = ($unrelatedProcessIds -join ', ')
        Show-UserMessage `
            -Message "Left unrelated listener process ID(s) $unrelatedText running." `
            -Kind 'Warning'
    }
}
catch {
    Show-UserMessage -Message $_.Exception.Message -Kind 'Error'
    exit 1
}
