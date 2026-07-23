[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'portable-launcher.Tests.ps1')
& (Join-Path $PSScriptRoot 'portable-installer.Tests.ps1')

Write-Output 'portable_tests=passed'
