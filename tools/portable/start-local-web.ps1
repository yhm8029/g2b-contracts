[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$port = 5182
$url = 'http://127.0.0.1:5182/competitors'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Definition
$installRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $scriptDirectory -ChildPath '..'))
$appPath = [System.IO.Path]::GetFullPath((Join-Path -Path $installRoot -ChildPath 'app'))
$databasePath = [System.IO.Path]::GetFullPath((Join-Path -Path $installRoot -ChildPath 'data\g2b-contracts.sqlite'))
$logsPath = [System.IO.Path]::GetFullPath((Join-Path -Path $installRoot -ChildPath 'logs'))
$stdoutPath = Join-Path -Path $logsPath -ChildPath 'local-web.stdout.log'
$stderrPath = Join-Path -Path $logsPath -ChildPath 'local-web.stderr.log'

function Test-HttpEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetUrl
    )

    $request = [System.Net.HttpWebRequest]::Create($TargetUrl)
    $request.Method = 'GET'
    $request.Timeout = 1000
    $request.ReadWriteTimeout = 1000
    $request.AllowAutoRedirect = $true
    $request.Proxy = $null

    try {
        $response = $request.GetResponse()
        if ($null -ne $response) {
            $response.Close()
            return $true
        }
    }
    catch [System.Net.WebException] {
        if ($null -ne $_.Exception.Response) {
            $_.Exception.Response.Close()
            return $true
        }
    }
    catch {
    }

    return $false
}

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

try {
    if (Test-HttpEndpoint -TargetUrl $url) {
        Start-Process -FilePath $url | Out-Null
        exit 0
    }

    $listenerProcessIds = @(Get-ListeningProcessIds)
    if ($listenerProcessIds.Count -gt 0) {
        $processText = ($listenerProcessIds -join ', ')
        throw "Port $port is already in use by process ID(s) $processText. The unrelated process was not stopped."
    }

    if (-not (Test-Path -LiteralPath $appPath -PathType Container)) {
        throw "Portable app directory was not found: $appPath"
    }

    if (-not (Test-Path -LiteralPath (Join-Path -Path $appPath -ChildPath 'node_modules') -PathType Container)) {
        throw "Portable node_modules directory was not found: $(Join-Path -Path $appPath -ChildPath 'node_modules')"
    }

    if (-not (Test-Path -LiteralPath (Join-Path -Path $appPath -ChildPath '.next\BUILD_ID') -PathType Leaf)) {
        throw "Portable Next.js build was not found: $(Join-Path -Path $appPath -ChildPath '.next\BUILD_ID')"
    }

    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null

    $npxCommand = Get-Command -Name 'npx.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $npxCommand) {
        throw 'npx.cmd was not found on PATH. Install Node.js and try again.'
    }

    $npxPath = [string]$npxCommand.Source
    if ([string]::IsNullOrWhiteSpace($npxPath)) {
        $npxPath = [string]$npxCommand.Definition
    }

    $env:DATABASE_URL = $databasePath
    try {
        $serverProcess = Start-Process `
            -FilePath $npxPath `
            -ArgumentList @('next', 'start', '-H', '127.0.0.1', '-p', [string]$port) `
            -WorkingDirectory $appPath `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -WindowStyle Hidden `
            -PassThru
    }
    catch {
        throw "Could not start the local web server. Check stdout log: $stdoutPath; stderr log: $stderrPath. $($_.Exception.Message)"
    }

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpEndpoint -TargetUrl $url) {
            Start-Process -FilePath $url | Out-Null
            exit 0
        }

        if ($serverProcess.HasExited) {
            break
        }

        Start-Sleep -Milliseconds 500
    }

    throw "Local web server did not become ready within 30 seconds. Check stdout log: $stdoutPath; stderr log: $stderrPath"
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
