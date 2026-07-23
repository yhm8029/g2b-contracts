[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$port = 5182
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Definition
$installRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $scriptDirectory -ChildPath '..'))
$appPath = [System.IO.Path]::GetFullPath((Join-Path -Path $installRoot -ChildPath 'app'))
$normalizedAppPath = $appPath.TrimEnd('\').Replace('/', '\')

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

    $commandLine = [string]$process.CommandLine
    $normalizedCommandLine = $commandLine.Replace('/', '\')
    return [pscustomobject]@{
        Id = [int]$process.ProcessId
        ParentId = [int]$process.ParentProcessId
        CommandLine = $commandLine
        NormalizedCommandLine = $normalizedCommandLine
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

    $portableTargets = @{}
    $unrelatedProcessIds = New-Object 'System.Collections.Generic.List[string]'

    foreach ($listenerProcessId in $listenerProcessIds) {
        $chain = @(Get-ProcessChain -StartingProcessId ([int]$listenerProcessId))
        $portableMatches = @(
            $chain | Where-Object {
                $_.NormalizedCommandLine.IndexOf($normalizedAppPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
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
        Write-Output "Port $port is used by unrelated process ID(s) $unrelatedText. No process was stopped."
        exit 0
    }

    $targets = @($portableTargets.Values | Sort-Object -Property Depth)
    foreach ($target in $targets) {
        Stop-Process -Id $target.Id -Force -ErrorAction Stop
        Write-Output "Stopped portable local web process $($target.Id)."
    }

    if ($unrelatedProcessIds.Count -gt 0) {
        $unrelatedText = ($unrelatedProcessIds -join ', ')
        Write-Output "Left unrelated listener process ID(s) $unrelatedText running."
    }
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
