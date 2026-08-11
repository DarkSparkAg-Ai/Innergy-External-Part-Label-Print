<#
.SYNOPSIS
    Tests for the Innergy Label Helper's HTTP layer, routing, validation and
    failure paths.

.DESCRIPTION
    Runs the real helper with only the printing call stubbed (see
    serve-stub.ps1), then drives it over real HTTP.

    Uses HttpClient rather than Invoke-WebRequest so it works on Windows
    PowerShell 5.1, where Invoke-WebRequest throws on any non-2xx response and
    has no -SkipHttpErrorCheck.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Run-Tests.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Net.Http

$Stub = Join-Path $PSScriptRoot 'serve-stub.ps1'
$Root = Join-Path ([System.IO.Path]::GetTempPath()) ("innergy-helper-tests-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$PwshExe = (Get-Process -Id $PID).Path

$script:Failures = 0
$script:Total = 0

function Check {
    param([string] $Name, [bool] $Condition, [string] $Detail = '')
    $script:Total++
    if ($Condition) {
        Write-Host "  PASS  $Name" -ForegroundColor Green
    } else {
        $script:Failures++
        Write-Host "  FAIL  $Name" -ForegroundColor Red
        if ($Detail) { Write-Host "        $Detail" -ForegroundColor DarkGray }
    }
}

function Start-StubServer {
    param(
        [string] $PrinterName = 'Zebra ZD420',
        [string] $LabelFolder,
        [int] $Port,
        [string] $AllowedOrigins = '*',
        [string] $Printers = 'Zebra ZD420'
    )

    # Every value is quoted: Start-Process joins ArgumentList on spaces, so an
    # unquoted "T:\NC Output\Labels" would arrive as three arguments.
    $quote = { param($Value) '"' + $Value + '"' }
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (& $quote $Stub),
        '-PrinterName', (& $quote $PrinterName),
        '-LabelFolder', (& $quote $LabelFolder),
        '-Port', $Port,
        '-Root', (& $quote $Root),
        '-AllowedOrigins', (& $quote $AllowedOrigins),
        '-InstalledPrinters', (& $quote $Printers)
    )

    $process = Start-Process -FilePath $PwshExe -ArgumentList $arguments -PassThru `
        -RedirectStandardOutput (Join-Path $Root "server-$Port.log") `
        -RedirectStandardError (Join-Path $Root "server-$Port.err")

    # Wait for the port to accept connections rather than sleeping blindly.
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $probe = New-Object System.Net.Sockets.TcpClient
            $probe.Connect('127.0.0.1', $Port)
            $probe.Close()
            return $process
        } catch { }
    }

    throw "Stub server on port $Port never came up. See $(Join-Path $Root "server-$Port.err")"
}

function Stop-StubServer {
    param($Process)
    try { $Process.Kill() } catch { }
    Start-Sleep -Milliseconds 300
}

function Invoke-Http {
    param(
        [string] $Uri,
        [string] $Method = 'GET',
        [string] $Body = $null,
        [hashtable] $Headers = @{}
    )

    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds(30)
    try {
        $request = New-Object System.Net.Http.HttpRequestMessage(
            (New-Object System.Net.Http.HttpMethod($Method)), $Uri)

        foreach ($name in $Headers.Keys) {
            $request.Headers.TryAddWithoutValidation($name, $Headers[$name]) | Out-Null
        }

        if ($null -ne $Body) {
            $request.Content = New-Object System.Net.Http.StringContent(
                $Body, [System.Text.Encoding]::UTF8, 'application/json')
        }

        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        $headerValues = @{}
        foreach ($header in $response.Headers) {
            $headerValues[$header.Key] = ($header.Value -join ',')
        }

        [pscustomobject]@{
            Status  = [int] $response.StatusCode
            Body    = $text
            Headers = $headerValues
            Json    = if ($text) { try { $text | ConvertFrom-Json } catch { $null } } else { $null }
        }
    } finally {
        $client.Dispose()
    }
}

function New-LabelFolder {
    param([string[]] $PartCodes)
    $folder = Join-Path $Root 'labels'
    if (-not (Test-Path -LiteralPath $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
    foreach ($code in $PartCodes) {
        Set-Content -LiteralPath (Join-Path $folder "$code.bmp") -Value 'stub-bitmap'
    }
    return $folder
}

function Get-PrintedCodes {
    $path = Join-Path $Root 'printed.txt'
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    @(Get-Content -LiteralPath $path | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_) })
}

function Reset-PrintLog {
    Remove-Item -LiteralPath (Join-Path $Root 'printed.txt') -ErrorAction SilentlyContinue
}

# Load the helper's own functions in-process for the unit-level checks below.
# Same AST trick as serve-stub.ps1, so these run the real implementations.
# Returns the source rather than defining anything: Invoke-Expression inside a
# function would define the helper's functions in that function's scope, where
# nothing else can see them.
function Get-HelperFunctionSource {
    $helperScript = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'helper/InnergyLabelHelper.ps1'
    $errors = $null
    $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($helperScript, [ref] $tokens, [ref] $errors)
    if ($errors) { throw "Helper script has parse errors: $($errors[0].Message)" }
    $functions = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
    return (($functions | ForEach-Object { $_.Extent.Text }) -join "`n")
}

# ---------------------------------------------------------------------------

New-Item -ItemType Directory -Path $Root -Force | Out-Null
$labelFolder = New-LabelFolder -PartCodes @('7604HA2K', '8102BX9L', 'AB12', 'EXPLODE1')

Write-Host ''
Write-Host 'Innergy Label Helper - tests' -ForegroundColor Cyan
Write-Host "Working folder: $Root" -ForegroundColor DarkGray

try {
    # =======================================================================
    Write-Host "`n=== health ===" -ForegroundColor Cyan
    $port = 47311
    $server = Start-StubServer -LabelFolder $labelFolder -Port $port
    try {
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/health"
        Check 'returns 200' ($response.Status -eq 200) "got $($response.Status)"
        Check 'reports the printer as found' ($response.Json.printerFound -eq $true)
        Check 'reports the folder as reachable' ($response.Json.folderReachable -eq $true)
        Check 'exposes warnThreshold for the extension' ($response.Json.warnThreshold -eq 10)
        Check 'reports its version' ([string]$response.Json.version -ne '')
        Check 'sends CORS allow-origin' ($response.Headers['Access-Control-Allow-Origin'] -eq '*')
        Check 'sends allow-private-network for Chrome' ($response.Headers['Access-Control-Allow-Private-Network'] -eq 'true')

        Write-Host "`n=== CORS preflight ===" -ForegroundColor Cyan
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'OPTIONS'
        Check 'preflight returns 204' ($response.Status -eq 204) "got $($response.Status)"
        Check 'preflight allows POST' ($response.Headers['Access-Control-Allow-Methods'] -like '*POST*')

        Write-Host "`n=== printing ===" -ForegroundColor Cyan
        Reset-PrintLog
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":["7604HA2K","NOPE123","8102BX9L"]}'
        Check 'prints the files that exist' ((@($response.Json.printed) -join ',') -eq '7604HA2K,8102BX9L') "got '$(@($response.Json.printed) -join ',')'"
        Check 'reports the ones that do not' ((@($response.Json.missing) -join ',') -eq 'NOPE123') "got '$(@($response.Json.missing) -join ',')'"
        Check 'error is null on success' ($null -eq $response.Json.error) "got '$($response.Json.error)'"

        Reset-PrintLog
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":["8102BX9L","AB12","7604HA2K"]}'
        Check 'prints in the order received, which is grid order' (((Get-PrintedCodes) -join ',') -eq '8102BX9L,AB12,7604HA2K') "got '$((Get-PrintedCodes) -join ',')'"

        Reset-PrintLog
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":["AB12","AB12","ab12"]}'
        Check 'prints one label per unique code, case-insensitively' ((Get-PrintedCodes).Count -eq 1) "printed $((Get-PrintedCodes).Count)"

        Write-Host "`n=== bad input ===" -ForegroundColor Cyan
        Reset-PrintLog
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":["../../../../etc/passwd","C:\\Windows\\win.ini","good/../bad"]}'
        Check 'refuses to leave the label folder' ((Get-PrintedCodes).Count -eq 0)
        Check 'reports the rejected codes as missing' (@($response.Json.missing).Count -eq 3) "got $(@($response.Json.missing).Count)"

        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":[]}'
        Check 'empty list is a BAD_REQUEST' ($response.Json.errorCode -eq 'BAD_REQUEST') "got '$($response.Json.errorCode)'"

        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{not json'
        Check 'malformed JSON returns 400' ($response.Status -eq 400) "got $($response.Status)"
        Check 'malformed JSON is a BAD_REQUEST' ($response.Json.errorCode -eq 'BAD_REQUEST')

        $response = Invoke-Http -Uri "http://127.0.0.1:$port/nope"
        Check 'unknown endpoint returns 404' ($response.Status -eq 404) "got $($response.Status)"

        Write-Host "`n=== response shape ===" -ForegroundColor Cyan
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":["AB12"]}'
        Check 'a single printed code is still a JSON array' ($response.Body -match '"printed":\s*\[') "body: $($response.Body)"
        Check 'an empty missing list is a JSON array' ($response.Body -match '"missing":\s*\[\s*\]') "body: $($response.Body)"

        Write-Host "`n=== a label the printer rejects ===" -ForegroundColor Cyan
        Reset-PrintLog
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":["AB12","EXPLODE1","7604HA2K"]}'
        Check 'the rest of the batch still prints' ((@($response.Json.printed) -join ',') -eq 'AB12,7604HA2K') "got '$(@($response.Json.printed) -join ',')'"
        Check 'reports PRINT_FAILED' ($response.Json.errorCode -eq 'PRINT_FAILED') "got '$($response.Json.errorCode)'"

        Write-Host "`n=== logging ===" -ForegroundColor Cyan
        $logs = @(Get-ChildItem -LiteralPath (Join-Path $Root 'logs') -Filter '*.log' -ErrorAction SilentlyContinue)
        Check 'writes a log file' ($logs.Count -ge 1)
        if ($logs.Count -ge 1) {
            $logText = Get-Content -LiteralPath $logs[0].FullName -Raw
            Check 'logs each request' ($logText -match 'Print request:')
            Check 'logs each result' ($logText -match 'Result: printed')
            Check 'logs rejected part codes' ($logText -match 'Rejected part code')
            Check 'logs print failures' ($logText -match 'Failed to print')
        }
    } finally {
        Stop-StubServer $server
    }

    # =======================================================================
    Write-Host "`n=== label folder unreachable ===" -ForegroundColor Cyan
    $port = 47312
    $server = Start-StubServer -LabelFolder 'T:\NC Output\Labels' -Port $port
    try {
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/health"
        Check 'health reports the folder unreachable' ($response.Json.folderReachable -eq $false)
        Check 'health still reports the printer found' ($response.Json.printerFound -eq $true)

        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":["AB12"]}'
        Check 'print returns FOLDER_UNREACHABLE' ($response.Json.errorCode -eq 'FOLDER_UNREACHABLE') "got '$($response.Json.errorCode)'"
        Check 'nothing is reported as printed' (@($response.Json.printed).Count -eq 0)
        Check 'the message names the folder' ($response.Json.error -like '*NC Output*') "got '$($response.Json.error)'"
    } finally {
        Stop-StubServer $server
    }

    # =======================================================================
    Write-Host "`n=== printer not installed ===" -ForegroundColor Cyan
    $port = 47313
    Reset-PrintLog
    $server = Start-StubServer -PrinterName 'Zebra ZD999 Not Here' -LabelFolder $labelFolder -Port $port
    try {
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/health"
        Check 'health reports the printer missing' ($response.Json.printerFound -eq $false)
        Check 'health reports the folder fine' ($response.Json.folderReachable -eq $true)

        $response = Invoke-Http -Uri "http://127.0.0.1:$port/print" -Method 'POST' -Body '{"partCodes":["AB12"]}'
        Check 'print returns PRINTER_NOT_FOUND' ($response.Json.errorCode -eq 'PRINTER_NOT_FOUND') "got '$($response.Json.errorCode)'"
        Check 'fails loudly instead of printing elsewhere' ((Get-PrintedCodes).Count -eq 0)
    } finally {
        Stop-StubServer $server
    }

    # =======================================================================
    Write-Host "`n=== restricted allowedOrigins ===" -ForegroundColor Cyan
    $port = 47314
    $server = Start-StubServer -LabelFolder $labelFolder -Port $port -AllowedOrigins 'chrome-extension://abcdef'
    try {
        $response = Invoke-Http -Uri "http://127.0.0.1:$port/health"
        Check 'a request with no Origin is not granted one' ($response.Headers['Access-Control-Allow-Origin'] -eq 'null') "got '$($response.Headers['Access-Control-Allow-Origin'])'"

        $response = Invoke-Http -Uri "http://127.0.0.1:$port/health" -Headers @{ Origin = 'chrome-extension://abcdef' }
        Check 'the listed origin is echoed back' ($response.Headers['Access-Control-Allow-Origin'] -eq 'chrome-extension://abcdef')

        $response = Invoke-Http -Uri "http://127.0.0.1:$port/health" -Headers @{ Origin = 'https://evil.example' }
        Check 'an unlisted origin is refused' ($response.Headers['Access-Control-Allow-Origin'] -eq 'null')
    } finally {
        Stop-StubServer $server
    }
    # =======================================================================
    Write-Host "`n=== printer name resolution ===" -ForegroundColor Cyan
    Invoke-Expression (Get-HelperFunctionSource)
    $script:ScriptDir = $Root
    $script:Version = '1.0.0-test'

    # The real printer list from a shop PC: the Zebra is installed under its
    # full UNC path, but nobody thinks of it by that name.
    $shopPrinters = @(
        'SHARP BP-50C26 PCL6', 'OneNote (Desktop)', 'Microsoft Print to PDF',
        'Lexmark Universal v2 XL', 'Fax', 'Bluebeam PDF',
        '\\Prec-FP2T753.lcinet.local\ZDesigner GK420d'
    )
    function Get-InstalledPrinters { $shopPrinters }

    $resolved = Resolve-PrinterName -PrinterName 'ZDesigner GK420d'
    Check 'the short name finds the network printer' ($resolved.Found -eq $true) "reason: $($resolved.Reason)"
    Check 'it resolves to the full UNC name' ($resolved.Name -eq '\\Prec-FP2T753.lcinet.local\ZDesigner GK420d') "got '$($resolved.Name)'"

    $resolved = Resolve-PrinterName -PrinterName '\\Prec-FP2T753.lcinet.local\ZDesigner GK420d'
    Check 'the full UNC name still matches exactly' ($resolved.Found -eq $true -and $resolved.Reason -eq 'exact match')

    $resolved = Resolve-PrinterName -PrinterName 'microsoft print to pdf'
    Check 'matching ignores case' ($resolved.Found -eq $true -and $resolved.Name -eq 'Microsoft Print to PDF')

    $resolved = Resolve-PrinterName -PrinterName 'Zebra ZD420'
    Check 'an unknown printer is still not found' ($resolved.Found -eq $false)

    $resolved = Resolve-PrinterName -PrinterName ''
    Check 'a blank printer name is not found' ($resolved.Found -eq $false)

    # Ambiguity must never be resolved by guessing.
    $ambiguous = @('\\ServerA\ZDesigner GK420d', '\\ServerB\ZDesigner GK420d')
    function Get-InstalledPrinters { $ambiguous }
    $resolved = Resolve-PrinterName -PrinterName 'ZDesigner GK420d'
    Check 'the same share name on two servers is refused' ($resolved.Found -eq $false)
    Check 'and the reason says to use the full name' ($resolved.Reason -like '*full name*') "got '$($resolved.Reason)'"

    # =======================================================================
    Write-Host "`n=== config.json parsing ===" -ForegroundColor Cyan
    function Get-InstalledPrinters { $shopPrinters }

    $configPath = Join-Path $Root 'config.json'

    # Correctly escaped: the baseline.
    Set-Content -LiteralPath $configPath -Encoding UTF8 -Value @'
{ "printerName": "\\\\Prec-FP2T753\\ZDesigner GK420d", "labelFolder": "T:\\NC Output\\Labels", "port": 47113 }
'@
    $config = Read-Config -Path $configPath
    Check 'reads a correctly escaped UNC printer name' ($config.printerName -eq '\\Prec-FP2T753\ZDesigner GK420d') "got '$($config.printerName)'"
    Check 'reads a Windows path' ($config.labelFolder -eq 'T:\NC Output\Labels') "got '$($config.labelFolder)'"

    # Pasted straight from the printer list, backslashes not doubled. This is
    # invalid JSON, and refusing to start over it helps nobody.
    Set-Content -LiteralPath $configPath -Encoding UTF8 -Value @'
{ "printerName": "\\Prec-FP2T753.lcinet.local\ZDesigner GK420d", "labelFolder": "T:\NC Output\Labels", "port": 47113 }
'@
    $recovered = $null
    try { $recovered = Read-Config -Path $configPath } catch { $recovered = $null }
    Check 'recovers from unescaped backslashes instead of refusing to start' ($null -ne $recovered)
    if ($recovered) {
        Check 'and recovers the printer name intact' ($recovered.printerName -eq '\\Prec-FP2T753.lcinet.local\ZDesigner GK420d') "got '$($recovered.printerName)'"
        Check 'and the label folder too' ($recovered.labelFolder -eq 'T:\NC Output\Labels') "got '$($recovered.labelFolder)'"
        Check 'so the pasted name resolves to a real printer' ((Resolve-PrinterName -PrinterName $recovered.printerName).Found -eq $true)
    }

    # Genuinely broken JSON must still fail, with a message that helps.
    Set-Content -LiteralPath $configPath -Encoding UTF8 -Value '{ "printerName": '
    $failure = $null
    try { Read-Config -Path $configPath | Out-Null } catch { $failure = $_.Exception.Message }
    Check 'still rejects JSON that is truly broken' ($null -ne $failure)
    Check 'and explains how to escape a network printer name' ($failure -like '*\\\\Server\\*') "got '$failure'"

    # A missing printerName is a setup error, not something to guess around.
    Set-Content -LiteralPath $configPath -Encoding UTF8 -Value '{ "labelFolder": "T:\\Labels" }'
    $failure = $null
    try { Read-Config -Path $configPath | Out-Null } catch { $failure = $_.Exception.Message }
    Check 'requires printerName to be set' ($failure -like '*printerName*')
} finally {
    Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host "ALL $($script:Total) CHECKS PASSED" -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($script:Failures) OF $($script:Total) CHECKS FAILED" -ForegroundColor Red
    exit 1
}
