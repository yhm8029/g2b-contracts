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
$runtimePath = [System.IO.Path]::GetFullPath((Join-Path -Path $installRoot -ChildPath 'runtime'))
$metadataPath = Join-Path -Path $runtimePath -ChildPath 'server.json'
$stdoutPath = Join-Path -Path $logsPath -ChildPath 'local-web.stdout.log'
$stderrPath = Join-Path -Path $logsPath -ChildPath 'local-web.stderr.log'
$normalizedAppPath = $appPath.TrimEnd('\').Replace('/', '\')

function Show-UserMessage {
    param(
        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Message,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Error', 'Warning')]
        [string]$Kind
    )

    $safeMessage = if ([string]::IsNullOrWhiteSpace($Message)) {
        'The portable launcher encountered an unknown error.'
    }
    else {
        $Message
    }
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
                $safeMessage,
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
        try {
            Write-Error -Message $safeMessage -ErrorAction Continue
        }
        catch {
            try {
                [System.Console]::Error.WriteLine($safeMessage)
            }
            catch {
            }
        }
    }
    elseif (-not $messageWasShown) {
        try {
            Write-Warning -Message $safeMessage
        }
        catch {
        }
    }
}

function Normalize-PathForComparison {
    param(
        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    try {
        return [System.IO.Path]::GetFullPath($Path).TrimEnd('\').Replace('/', '\')
    }
    catch {
        return $null
    }
}

function Test-CreationTimeMatches {
    param(
        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Expected,

        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Actual
    )

    if ([string]::IsNullOrWhiteSpace($Expected) -or
        [string]::IsNullOrWhiteSpace($Actual)) {
        return $false
    }

    try {
        $expectedTime = [datetime]::Parse(
            $Expected,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::RoundtripKind
        ).ToUniversalTime()
        $actualTime = [datetime]::Parse(
            $Actual,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::RoundtripKind
        ).ToUniversalTime()
        return [math]::Abs(($expectedTime - $actualTime).TotalMilliseconds) -le 1000
    }
    catch {
        return $false
    }
}

function Test-CommandLineContainsExactPath {
    param(
        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$CommandLine,

        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$ExpectedPath
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine) -or
        [string]::IsNullOrWhiteSpace($ExpectedPath)) {
        return $false
    }

    $normalizedExpectedPath = Normalize-PathForComparison -Path $ExpectedPath
    if ([string]::IsNullOrWhiteSpace($normalizedExpectedPath)) {
        return $false
    }

    $normalizedCommandLine = $CommandLine.Replace('/', '\')
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

function Test-HttpEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetUrl
    )

    $request = [System.Net.HttpWebRequest]::Create($TargetUrl)
    $request.Method = 'GET'
    $request.Timeout = 1000
    $request.ReadWriteTimeout = 1000
    $request.AllowAutoRedirect = $false
    $request.Proxy = $null

    try {
        $response = [System.Net.HttpWebResponse]$request.GetResponse()
        try {
            return $response.StatusCode -eq [System.Net.HttpStatusCode]::OK
        }
        finally {
            $response.Close()
        }
    }
    catch [System.Net.WebException] {
        if ($null -ne $_.Exception.Response) {
            $_.Exception.Response.Close()
        }
        return $false
    }
    catch {
        return $false
    }
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

function Test-PortableServerIdentity {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Metadata,

        [Parameter(Mandatory = $true)]
        [object[]]$ProcessChain,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedAppPath
    )

    try {
        if (($ProcessChain.Count -eq 0) -or
            [string]::IsNullOrWhiteSpace([string]$Metadata.ListenerCreationTimeUtc) -or
            [string]::IsNullOrWhiteSpace([string]$Metadata.RootCreationTimeUtc)) {
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

        $listener = $ProcessChain[0]
        if (([int]$Metadata.ListenerProcessId -ne [int]$listener.Id) -or
            (-not (Test-CreationTimeMatches `
                    -Expected ([string]$Metadata.ListenerCreationTimeUtc) `
                    -Actual ([string]$listener.CreationTimeUtc)))) {
            return $false
        }

        $root = $ProcessChain |
            Where-Object { $_.Id -eq [int]$Metadata.RootProcessId } |
            Select-Object -First 1
        if (($null -eq $root) -or
            (-not (Test-CreationTimeMatches `
                    -Expected ([string]$Metadata.RootCreationTimeUtc) `
                    -Actual ([string]$root.CreationTimeUtc)))) {
            return $false
        }

        return Test-CommandLineContainsExactPath `
            -CommandLine $listener.CommandLine `
            -ExpectedPath $expectedNormalizedAppPath
    }
    catch {
        return $false
    }
}

function Get-PortableListenerDetails {
    $matches = New-Object 'System.Collections.Generic.List[object]'

    foreach ($listenerProcessId in @(Get-ListeningProcessIds)) {
        $chain = @(Get-ProcessChain -StartingProcessId ([int]$listenerProcessId))
        $hasExactAppPath = @(
            $chain | Where-Object {
                Test-CommandLineContainsExactPath `
                    -CommandLine $_.CommandLine `
                    -ExpectedPath $normalizedAppPath
            }
        ).Count -gt 0

        if ($hasExactAppPath -and
            ($chain.Count -gt 0) -and
            (-not [string]::IsNullOrWhiteSpace($chain[0].CreationTimeUtc))) {
            [void]$matches.Add($chain[0])
        }
    }

    return @($matches.ToArray())
}

function Write-ServerMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Listener,

        [Parameter(Mandatory = $true)]
        [int]$RootProcessId,

        [Parameter(Mandatory = $true)]
        [string]$RootCreationTimeUtc
    )

    New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
    $metadata = [ordered]@{
        Version = 1
        AppPath = $normalizedAppPath
        RootProcessId = $RootProcessId
        RootCreationTimeUtc = $RootCreationTimeUtc
        ListenerProcessId = [int]$Listener.Id
        ListenerCreationTimeUtc = [string]$Listener.CreationTimeUtc
        StartedAtUtc = [datetime]::UtcNow.ToString('o')
    }
    $json = $metadata | ConvertTo-Json
    $temporaryMetadataPath = "$metadataPath.tmp"
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporaryMetadataPath, $json, $utf8WithoutBom)
    Move-Item -LiteralPath $temporaryMetadataPath -Destination $metadataPath -Force
}

$startedRootProcessId = 0
$startedRootCreationTimeUtc = ''
$metadataWasWrittenByThisLaunch = $false

function Stop-StartedProcessTree {
    param(
        [Parameter(Mandatory = $true)]
        [int]$RootProcessId,

        [Parameter(Mandatory = $true)]
        [string]$RootCreationTimeUtc
    )

    if (($RootProcessId -le 0) -or [string]::IsNullOrWhiteSpace($RootCreationTimeUtc)) {
        return
    }

    try {
        $snapshot = @(
            Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
                ForEach-Object {
                    $creationTimeUtc = ''
                    if ($null -ne $_.CreationDate) {
                        $creationTimeUtc = ([datetime]$_.CreationDate).ToUniversalTime().ToString('o')
                    }

                    [pscustomobject]@{
                        Id = [int]$_.ProcessId
                        ParentId = [int]$_.ParentProcessId
                        CommandLine = [string]$_.CommandLine
                        CreationTimeUtc = $creationTimeUtc
                    }
                }
        )
    }
    catch {
        return
    }

    $rootRecord = $snapshot | Where-Object { $_.Id -eq $RootProcessId } | Select-Object -First 1
    $rootIsSameProcess = ($null -ne $rootRecord) -and
        (Test-CreationTimeMatches `
            -Expected $RootCreationTimeUtc `
            -Actual $rootRecord.CreationTimeUtc)
    if (($null -ne $rootRecord) -and (-not $rootIsSameProcess)) {
        # A different creation time means the root PID was reused; fail closed.
        return
    }

    $depthByProcessId = @{}
    $depthByProcessId[[string]$RootProcessId] = 0
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $snapshot) {
            $processKey = [string]$process.Id
            $parentKey = [string]$process.ParentId
            if ((-not $depthByProcessId.ContainsKey($processKey)) -and
                $depthByProcessId.ContainsKey($parentKey)) {
                $depthByProcessId[$processKey] = [int]$depthByProcessId[$parentKey] + 1
                $changed = $true
            }
        }
    }

    $rootStartedAt = [datetime]::Parse(
        $RootCreationTimeUtc,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind
    )
    $targets = New-Object 'System.Collections.Generic.List[object]'
    foreach ($process in $snapshot) {
        $processKey = [string]$process.Id
        if (-not $depthByProcessId.ContainsKey($processKey)) {
            continue
        }

        $isRoot = $process.Id -eq $RootProcessId
        $isSafeDescendant = $false
        if (-not $isRoot) {
            if ($rootIsSameProcess) {
                $isSafeDescendant = $true
            }
            elseif (-not [string]::IsNullOrWhiteSpace($process.CreationTimeUtc)) {
                $processStartedAt = [datetime]::Parse(
                    $process.CreationTimeUtc,
                    [System.Globalization.CultureInfo]::InvariantCulture,
                    [System.Globalization.DateTimeStyles]::RoundtripKind
                )
                $isSafeDescendant = ($processStartedAt -ge $rootStartedAt) -and
                    (Test-CommandLineContainsExactPath `
                        -CommandLine $process.CommandLine `
                        -ExpectedPath $normalizedAppPath)
            }
        }

        if (($isRoot -and $rootIsSameProcess) -or $isSafeDescendant) {
            $process | Add-Member `
                -NotePropertyName Depth `
                -NotePropertyValue ([int]$depthByProcessId[$processKey])
            [void]$targets.Add($process)
        }
    }

    foreach ($target in @($targets.ToArray() | Sort-Object -Property Depth -Descending)) {
        $current = Get-ProcessDetails -ProcessId $target.Id
        if (($null -ne $current) -and
            (Test-CreationTimeMatches `
                -Expected $target.CreationTimeUtc `
                -Actual $current.CreationTimeUtc)) {
            Stop-Process -Id $target.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    if (Test-HttpEndpoint -TargetUrl $url) {
        $existingMetadata = $null
        if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
            try {
                $existingMetadata = Get-Content `
                    -Raw `
                    -LiteralPath $metadataPath `
                    -Encoding UTF8 | ConvertFrom-Json
            }
            catch {
                $existingMetadata = $null
            }
        }

        $existingListenerProcessIds = @(Get-ListeningProcessIds)
        $existingIdentityMatches = $false
        if (($null -ne $existingMetadata) -and ($existingListenerProcessIds.Count -eq 1)) {
            $existingProcessChain = @(
                Get-ProcessChain -StartingProcessId ([int]$existingListenerProcessIds[0])
            )
            $existingIdentityMatches = Test-PortableServerIdentity `
                -Metadata $existingMetadata `
                -ProcessChain $existingProcessChain `
                -ExpectedAppPath $normalizedAppPath
        }

        if ($existingIdentityMatches) {
            Start-Process -FilePath $url | Out-Null
            exit 0
        }

        $processText = if ($existingListenerProcessIds.Count -gt 0) {
            $existingListenerProcessIds -join ', '
        }
        else {
            'unknown'
        }
        throw "Port $port returned HTTP 200 from unrelated process ID(s) $processText. The browser was not opened and no process was stopped."
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
    New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
    Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue

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

    $serverRootDetails = Get-ProcessDetails -ProcessId $serverProcess.Id
    $serverRootCreationTimeUtc = ''
    if ($null -ne $serverRootDetails) {
        $serverRootCreationTimeUtc = $serverRootDetails.CreationTimeUtc
    }
    if ([string]::IsNullOrWhiteSpace($serverRootCreationTimeUtc)) {
        try {
            $serverRootCreationTimeUtc = $serverProcess.StartTime.ToUniversalTime().ToString('o')
        }
        catch {
            $serverRootCreationTimeUtc = ''
        }
    }
    $startedRootProcessId = $serverProcess.Id
    $startedRootCreationTimeUtc = $serverRootCreationTimeUtc

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpEndpoint -TargetUrl $url) {
            $portableListeners = @(Get-PortableListenerDetails)
            if ($portableListeners.Count -ne 1) {
                throw "The ready listener could not be tied to exactly one process under $appPath."
            }

            Write-ServerMetadata `
                -Listener $portableListeners[0] `
                -RootProcessId $serverProcess.Id `
                -RootCreationTimeUtc $serverRootCreationTimeUtc
            $metadataWasWrittenByThisLaunch = $true
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
    if ($startedRootProcessId -gt 0) {
        Stop-StartedProcessTree `
            -RootProcessId $startedRootProcessId `
            -RootCreationTimeUtc $startedRootCreationTimeUtc
    }
    if (($startedRootProcessId -gt 0) -and $metadataWasWrittenByThisLaunch) {
        Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
    }
    Show-UserMessage -Message $_.Exception.Message -Kind 'Error'
    exit 1
}
