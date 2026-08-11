<#
.SYNOPSIS
    Boots the real helper's HTTP server with the Windows-only printing calls
    stubbed out, for use by Run-Tests.ps1.

.DESCRIPTION
    Pulls the function definitions straight out of InnergyLabelHelper.ps1 via
    its AST, so the request parsing, routing, validation and result shaping
    under test are the real production code. Only Get-InstalledPrinters and
    Invoke-PrintBitmap are replaced - those need System.Drawing and a real
    spooler.

    Runs as its own process so the test can kill it by PID; Stop-Job deadlocks
    against a job parked in AcceptTcpClient.
#>
param(
    [Parameter(Mandatory = $true)] [string] $PrinterName,
    [Parameter(Mandatory = $true)] [string] $LabelFolder,
    [Parameter(Mandatory = $true)] [int]    $Port,
    [Parameter(Mandatory = $true)] [string] $Root,
    [string] $AllowedOrigins = '*',
    [string] $InstalledPrinters = 'Zebra ZD420'
)

$ErrorActionPreference = 'Stop'

$helperScript = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'helper\InnergyLabelHelper.ps1'
if (-not (Test-Path -LiteralPath $helperScript)) {
    $helperScript = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'helper/InnergyLabelHelper.ps1'
}

$errors = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($helperScript, [ref] $tokens, [ref] $errors)
if ($errors) { throw "Helper script has parse errors: $($errors[0].Message)" }

$functions = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
Invoke-Expression (($functions | ForEach-Object { $_.Extent.Text }) -join "`n")

$script:Version = '1.0.0-test'
$script:ScriptDir = $Root
$script:PartCodePattern = '^[A-Za-z0-9_.]{1,120}$'

$printers = $InstalledPrinters -split ','
function Get-InstalledPrinters { $printers }

function Invoke-PrintBitmap {
    param($Path, $PrinterName, $DocumentName, $Config)
    # Record the print instead of spooling it. A part code containing EXPLODE
    # simulates the printer rejecting one label mid-batch.
    Add-Content -LiteralPath (Join-Path $Root 'printed.txt') -Value $Path
    if ($Path -like '*EXPLODE*') { throw 'simulated printer failure' }
}

Start-HelperServer -Config @{
    printerName      = $PrinterName
    labelFolder      = $LabelFolder
    port             = $Port
    warnThreshold    = 10
    scaleMode        = 'fit'
    autoRotate       = $false
    logRetentionDays = 30
    allowedOrigins   = ($AllowedOrigins -split ',')
}
