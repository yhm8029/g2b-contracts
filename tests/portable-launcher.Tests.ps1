[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$startScriptPath = Join-Path $repositoryRoot 'tools\portable\start-local-web.ps1'
$stopScriptPath = Join-Path $repositoryRoot 'tools\portable\stop-local-web.ps1'

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

function Invoke-HttpStatusFixture {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(200, 404, 500)]
        [int]$StatusCode
    )

    $portProbe = New-Object System.Net.Sockets.TcpListener(
        [System.Net.IPAddress]::Loopback,
        0
    )
    $portProbe.Start()
    $fixturePort = ([System.Net.IPEndPoint]$portProbe.LocalEndpoint).Port
    $portProbe.Stop()

    $ready = New-Object System.Threading.ManualResetEvent($false)
    $server = [PowerShell]::Create()
    $serverScript = {
        param($Port, $ResponseStatusCode, $ReadyEvent)

        $reason = switch ($ResponseStatusCode) {
            200 { 'OK' }
            404 { 'Not Found' }
            500 { 'Internal Server Error' }
        }
        $listener = New-Object System.Net.Sockets.TcpListener(
            [System.Net.IPAddress]::Loopback,
            $Port
        )

        try {
            $listener.Start()
            [void]$ReadyEvent.Set()
            $client = $listener.AcceptTcpClient()
            try {
                $response = "HTTP/1.1 $ResponseStatusCode $reason`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
                $bytes = [System.Text.Encoding]::ASCII.GetBytes($response)
                $stream = $client.GetStream()
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush()
            }
            finally {
                $client.Close()
            }
        }
        finally {
            $listener.Stop()
        }
    }

    [void]$server.AddScript($serverScript).AddArgument($fixturePort).AddArgument($StatusCode).AddArgument($ready)
    $asyncResult = $server.BeginInvoke()

    try {
        Assert-True -Condition $ready.WaitOne(5000) -Message "HTTP $StatusCode fixture did not start"
        return Test-HttpEndpoint -TargetUrl "http://127.0.0.1:$fixturePort/"
    }
    finally {
        if (-not $asyncResult.IsCompleted) {
            $server.Stop()
        }
        else {
            [void]$server.EndInvoke($asyncResult)
        }
        $server.Dispose()
        $ready.Dispose()
    }
}

$startAst = Get-ScriptAst -Path $startScriptPath
$stopAst = Get-ScriptAst -Path $stopScriptPath

Invoke-Expression (Get-FunctionDefinition -Ast $startAst -Name 'Test-HttpEndpoint')

Assert-True -Condition (Invoke-HttpStatusFixture -StatusCode 200) -Message 'HTTP 200 must be ready'
Assert-True -Condition (-not (Invoke-HttpStatusFixture -StatusCode 404)) -Message 'HTTP 404 must not be ready'
Assert-True -Condition (-not (Invoke-HttpStatusFixture -StatusCode 500)) -Message 'HTTP 500 must not be ready'

Invoke-Expression (Get-FunctionDefinition -Ast $stopAst -Name 'Normalize-PathForComparison')
Invoke-Expression (Get-FunctionDefinition -Ast $stopAst -Name 'Test-CommandLineContainsExactPath')
Invoke-Expression (Get-FunctionDefinition -Ast $stopAst -Name 'Test-MetadataMatchesListener')
Invoke-Expression (Get-FunctionDefinition -Ast $startAst -Name 'Test-PortableServerIdentity')
Invoke-Expression (Get-FunctionDefinition -Ast $stopAst -Name 'Test-ProcessIdentityUnchanged')
Invoke-Expression (Get-FunctionDefinition -Ast $startAst -Name 'Show-UserMessage')
Invoke-Expression (Get-FunctionDefinition -Ast $stopAst -Name 'Test-CreationTimeMatches')

Assert-True -Condition (Test-CreationTimeMatches `
        -Expected '2026-07-23T01:02:03.1000000Z' `
        -Actual '2026-07-23T01:02:03.9000000Z') -Message 'Sub-second creation precision differences must match'
Assert-True -Condition (-not (Test-CreationTimeMatches `
            -Expected '2026-07-23T01:02:03.0000000Z' `
            -Actual '2026-07-23T01:02:05.0000000Z')) -Message 'Creation times two seconds apart must not match'

$creationProbe = Start-Process powershell.exe `
    -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 5') `
    -WindowStyle Hidden `
    -PassThru
try {
    Start-Sleep -Milliseconds 250
    $firstCreation = Get-CimInstance Win32_Process -Filter "ProcessId = $($creationProbe.Id)"
    Start-Sleep -Milliseconds 100
    $secondCreation = Get-CimInstance Win32_Process -Filter "ProcessId = $($creationProbe.Id)"
    $firstCreationUtc = ([datetime]$firstCreation.CreationDate).ToUniversalTime().ToString('o')
    $secondCreationUtc = ([datetime]$secondCreation.CreationDate).ToUniversalTime().ToString('o')
    Assert-True -Condition (Test-CreationTimeMatches `
            -Expected $firstCreationUtc `
            -Actual $secondCreationUtc) -Message 'Repeated CIM creation time reads must match'
}
finally {
    Stop-Process -Id $creationProbe.Id -Force -ErrorAction SilentlyContinue
}

$fixtureAppPath = 'C:\Portable Root\app'
Assert-True -Condition (Test-CommandLineContainsExactPath `
        -CommandLine '"C:\Program Files\nodejs\node.exe" "C:\Portable Root\app\node_modules\next\dist\bin\next"' `
        -ExpectedPath $fixtureAppPath) -Message 'Quoted app child path must match'
Assert-True -Condition (Test-CommandLineContainsExactPath `
        -CommandLine 'node.exe C:\Portable\app\node_modules\next\server.js' `
        -ExpectedPath 'C:\Portable\app') -Message 'Unquoted app child path must match'
Assert-True -Condition (-not (Test-CommandLineContainsExactPath `
            -CommandLine '"C:\Portable Root\app-backup\node_modules\next\server.js"' `
            -ExpectedPath $fixtureAppPath)) -Message 'app-backup must not match app'
Assert-True -Condition (-not (Test-CommandLineContainsExactPath `
            -CommandLine '"C:\Portable Root\myapp\node_modules\next\server.js"' `
            -ExpectedPath $fixtureAppPath)) -Message 'Path suffixes must not match app'
Assert-True -Condition (-not (Test-CommandLineContainsExactPath `
            -CommandLine '"XC:\Portable Root\app\node_modules\next\server.js"' `
            -ExpectedPath $fixtureAppPath)) -Message 'A path without a leading token boundary must not match'
Assert-True -Condition (-not (Test-CommandLineContainsExactPath `
            -CommandLine '' `
            -ExpectedPath $fixtureAppPath)) -Message 'Empty command lines must fail closed'
Assert-True -Condition (-not (Test-CommandLineContainsExactPath `
            -CommandLine $null `
            -ExpectedPath $fixtureAppPath)) -Message 'Null command lines must fail closed'

$messageDisplayThrew = $false
try {
    Show-UserMessage -Message '' -Kind 'Error' 2>$null
}
catch {
    $messageDisplayThrew = $true
}
Assert-True -Condition (-not $messageDisplayThrew) -Message 'Empty error messages must not throw'

$listenerFixture = [pscustomobject]@{
    Id = 8123
    CreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
}
$validMetadataFixture = [pscustomobject]@{
    AppPath = $fixtureAppPath
    ListenerProcessId = 8123
    ListenerCreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
}
Assert-True -Condition (Test-MetadataMatchesListener `
        -Metadata $validMetadataFixture `
        -Listener $listenerFixture `
        -ExpectedAppPath $fixtureAppPath) -Message 'Matching PID, creation time, and app path must pass'

$reusedPidMetadataFixture = [pscustomobject]@{
    AppPath = $fixtureAppPath
    ListenerProcessId = 8123
    ListenerCreationTimeUtc = '2026-07-23T01:02:05.0000000Z'
}
Assert-True -Condition (-not (Test-MetadataMatchesListener `
            -Metadata $reusedPidMetadataFixture `
            -Listener $listenerFixture `
            -ExpectedAppPath $fixtureAppPath)) -Message 'Reused PID with a different creation time must fail'

$wrongPathMetadataFixture = [pscustomobject]@{
    AppPath = 'C:\Portable Root\app-backup'
    ListenerProcessId = 8123
    ListenerCreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
}
Assert-True -Condition (-not (Test-MetadataMatchesListener `
            -Metadata $wrongPathMetadataFixture `
            -Listener $listenerFixture `
            -ExpectedAppPath $fixtureAppPath)) -Message 'Metadata for app-backup must fail'

$emptyCreationListenerFixture = [pscustomobject]@{
    Id = 8123
    CreationTimeUtc = ''
}
$emptyCreationMetadataFixture = [pscustomobject]@{
    AppPath = $fixtureAppPath
    ListenerProcessId = 8123
    ListenerCreationTimeUtc = ''
}
Assert-True -Condition (-not (Test-MetadataMatchesListener `
            -Metadata $emptyCreationMetadataFixture `
            -Listener $emptyCreationListenerFixture `
            -ExpectedAppPath $fixtureAppPath)) -Message 'Empty creation times must fail closed'

$portableIdentityMetadata = [pscustomobject]@{
    AppPath = $fixtureAppPath
    RootProcessId = 8000
    RootCreationTimeUtc = '2026-07-23T01:02:02.0000000Z'
    ListenerProcessId = 8123
    ListenerCreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
}
$portableIdentityChain = @(
    [pscustomobject]@{
        Id = 8123
        ParentId = 8000
        CommandLine = '"C:\Portable Root\app\node_modules\next\server.js"'
        CreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
    },
    [pscustomobject]@{
        Id = 8000
        ParentId = 7000
        CommandLine = 'npx.cmd "C:\Portable Root\app\node_modules\next\dist\bin\next" start'
        CreationTimeUtc = '2026-07-23T01:02:02.0000000Z'
    }
)
Assert-True -Condition (Test-PortableServerIdentity `
        -Metadata $portableIdentityMetadata `
        -ProcessChain $portableIdentityChain `
        -ExpectedAppPath $fixtureAppPath) -Message 'Matching portable listener/root identity must pass'

$unrelatedIdentityChain = @(
    [pscustomobject]@{
        Id = 8123
        ParentId = 8000
        CommandLine = '"C:\Portable Root\app-backup\node_modules\next\server.js"'
        CreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
    },
    $portableIdentityChain[1]
)
Assert-True -Condition (-not (Test-PortableServerIdentity `
            -Metadata $portableIdentityMetadata `
            -ProcessChain $unrelatedIdentityChain `
            -ExpectedAppPath $fixtureAppPath)) -Message 'Unrelated HTTP 200 listener must fail identity'

$currentTargetFixture = [pscustomobject]@{
    Id = 8123
    ParentId = 8000
    CommandLine = '"C:\Portable Root\app\node_modules\next\server.js"'
    CreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
}
Assert-True -Condition (Test-ProcessIdentityUnchanged `
        -Expected $portableIdentityChain[0] `
        -Current $currentTargetFixture) -Message 'Unchanged stop target identity must pass'
$currentTargetFixture.CreationTimeUtc = '2026-07-23T01:02:05.0000000Z'
Assert-True -Condition (-not (Test-ProcessIdentityUnchanged `
            -Expected $portableIdentityChain[0] `
            -Current $currentTargetFixture)) -Message 'Reused stop target PID must be skipped'
$currentTargetFixture.CreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
$currentTargetFixture.CommandLine = '"C:\Portable Root\app-backup\node_modules\next\server.js"'
Assert-True -Condition (-not (Test-ProcessIdentityUnchanged `
            -Expected $portableIdentityChain[0] `
            -Current $currentTargetFixture)) -Message 'Changed stop target command identity must be skipped'

$fixtureScriptPath = 'C:\Fixture Install\tools\start-local-web.ps1'
$fixtureInstallRoot = [System.IO.Path]::GetFullPath(
    (Join-Path (Split-Path -Parent $fixtureScriptPath) '..')
)
Assert-True -Condition ($fixtureInstallRoot -eq 'C:\Fixture Install') -Message 'Install root fixture calculation failed'

$startText = Get-Content -Raw -LiteralPath $startScriptPath
$stopText = Get-Content -Raw -LiteralPath $stopScriptPath

$koreanFolderName = -join @(
    [char]0xB098,
    [char]0xB77C,
    [char]0xC7A5,
    [char]0xD130
)
$utf8AppPath = "C:\Fixture\$koreanFolderName\app"
$utf8MetadataPath = Join-Path `
    ([System.IO.Path]::GetTempPath()) `
    "g2b-launcher-metadata-$([guid]::NewGuid().ToString('N')).json"
$utf8MetadataFixture = [ordered]@{
    AppPath = $utf8AppPath
    RootProcessId = 8000
    RootCreationTimeUtc = '2026-07-23T01:02:02.0000000Z'
    ListenerProcessId = 8123
    ListenerCreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
}
$utf8ProcessChain = @(
    [pscustomobject]@{
        Id = 8123
        ParentId = 8000
        CommandLine = "`"$utf8AppPath\node_modules\next\server.js`""
        CreationTimeUtc = '2026-07-23T01:02:03.0000000Z'
    },
    [pscustomobject]@{
        Id = 8000
        ParentId = 7000
        CommandLine = "npx.cmd `"$utf8AppPath\node_modules\next\dist\bin\next`" start"
        CreationTimeUtc = '2026-07-23T01:02:02.0000000Z'
    }
)
try {
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
        $utf8MetadataPath,
        ($utf8MetadataFixture | ConvertTo-Json),
        $utf8WithoutBom
    )
    $utf8ReadMetadata = Get-Content `
        -LiteralPath $utf8MetadataPath `
        -Raw `
        -Encoding UTF8 | ConvertFrom-Json
    Assert-True -Condition ($utf8ReadMetadata.AppPath -eq $utf8AppPath) `
        -Message 'BOMless UTF-8 metadata must preserve the Korean app path'
    Assert-True -Condition (Test-PortableServerIdentity `
            -Metadata $utf8ReadMetadata `
            -ProcessChain $utf8ProcessChain `
            -ExpectedAppPath $utf8AppPath) -Message 'UTF-8 metadata identity must pass'
}
finally {
    Remove-Item -LiteralPath $utf8MetadataPath -Force -ErrorAction SilentlyContinue
}

Assert-True -Condition (($startText -match "'runtime'") -and ($startText -match "'server\.json'")) `
    -Message 'Start metadata path is missing'
Assert-True -Condition ($startText -match 'Get-Content[\s\S]*?-Encoding UTF8[\s\S]*?ConvertFrom-Json') `
    -Message 'Start metadata must be read explicitly as UTF-8'
Assert-True -Condition ($stopText -match 'Get-Content[\s\S]*?-Encoding UTF8[\s\S]*?ConvertFrom-Json') `
    -Message 'Stop metadata must be read explicitly as UTF-8'
Assert-True -Condition ($startText -match '\$request\.AllowAutoRedirect\s*=\s*\$false') `
    -Message 'Readiness must not follow redirects'
Assert-True -Condition ($startText -match 'ListenerCreationTimeUtc') -Message 'Start metadata creation time is missing'
Assert-True -Condition ($stopText -match 'ConvertFrom-Json') -Message 'Stop metadata loading is missing'
Assert-True -Condition ($startText -match 'Stop-StartedProcessTree') -Message 'Startup cleanup is missing'
Assert-True -Condition ($startText -match 'root PID was reused|rootRecord.*rootIsSameProcess') `
    -Message 'Cleanup PID reuse guard is missing'
Assert-True -Condition ($startText -match 'metadataWasWrittenByThisLaunch') `
    -Message 'Metadata ownership guard is missing'
Assert-True -Condition ($startText -match 'System\.Windows\.Forms') -Message 'Start MessageBox fallback is missing'
Assert-True -Condition ($stopText -match 'System\.Windows\.Forms') -Message 'Stop MessageBox fallback is missing'
Assert-True -Condition (($startText -match 'G2B_LAUNCHER_NONINTERACTIVE') -and
    ($stopText -match 'G2B_LAUNCHER_NONINTERACTIVE')) -Message 'Non-interactive UI override is missing'
Assert-True -Condition ($stopText -match 'Warning') -Message 'Stop unrelated warning is missing'

Write-Output 'portable_launcher_tests=passed'
