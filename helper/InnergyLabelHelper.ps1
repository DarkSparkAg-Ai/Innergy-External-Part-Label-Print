<#
.SYNOPSIS
    Local print helper for the Innergy External Part Labels Chrome extension.

.DESCRIPTION
    Listens on 127.0.0.1 for print requests from the extension, finds
    [PartCode].bmp in the configured label folder, and prints each one to the
    configured Windows printer with no dialog.

    Endpoints:
      GET  /health  -> config, and whether the printer and folder are usable
      POST /print   -> { "partCodes": ["7604HA2K", ...] }
                       returns { printed, missing, error, errorCode }

    Design notes:
      * Uses TcpListener, not HttpListener. HttpListener needs an admin-created
        netsh urlacl reservation; TcpListener on loopback needs nothing. That
        keeps the install to "copy a folder and run it".
      * Printing goes through System.Drawing.Printing with a
        StandardPrintController, which is what suppresses the "printing page 1
        of 1" progress window. Without it, the print is not silent.

.PARAMETER ConfigPath
    Path to config.json. Defaults to config.json next to this script.

.PARAMETER SelfTest
    Check the config, printer and label folder, print a summary, and exit
    without starting the server.

.PARAMETER PrintTest
    With -SelfTest, also print this one part code as a live end-to-end test.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File InnergyLabelHelper.ps1 -SelfTest

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File InnergyLabelHelper.ps1 -SelfTest -PrintTest 7604HA2K
#>

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [switch] $SelfTest,
    [string] $PrintTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Version = '1.0.0'
$script:ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:PrintImage = $null
$script:ScaleMode = 'fit'
$script:AutoRotate = $false

Add-Type -AssemblyName System.Drawing

# A PartCode becomes a filename, so it must be simple. This is also what stops
# a crafted request from walking out of the label folder.
$script:PartCodePattern = '^[A-Za-z0-9_.]{1,120}$'

# ---------------------------------------------------------------------------
# Config and logging
# ---------------------------------------------------------------------------

function Get-DefaultConfig {
    # A plain hashtable, not [ordered]: an OrderedDictionary does not satisfy a
    # [hashtable] parameter type and every function below takes one.
    @{
        printerName    = ''
        labelFolder    = 'T:\NC Output\Labels'
        port           = 47113
        warnThreshold  = 10
        scaleMode      = 'fit'      # fit | fitDown | actual
        autoRotate     = $false
        logRetentionDays = 30
        allowedOrigins = @('*')
    }
}

function Read-Config {
    param([string] $Path)

    if (-not $Path) {
        $Path = Join-Path $script:ScriptDir 'config.json'
    }

    # Set before anything below can log: the log directory is derived from it.
    $script:ConfigPath = $Path

    $config = Get-DefaultConfig

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Config file not found: $Path`r`n" +
              "Copy config.sample.json to config.json and set printerName."
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8

    $parsed = $null
    try {
        $parsed = $raw | ConvertFrom-Json
    } catch {
        # A network printer name is a UNC path, and JSON treats a backslash as
        # an escape character - so pasting \\Server\Printer straight in is
        # invalid JSON. Nobody should have to know that, so repair it rather
        # than refusing to start.
        #
        # The repair is per string literal, because a half-edited config is the
        # normal case: the sample's "T:\\NC Output\\Labels" is already correct
        # while a freshly pasted printer name is raw. A string containing an
        # invalid escape must have been written raw, so every backslash in that
        # string gets escaped; a string whose backslashes all form valid
        # escapes is left exactly as it is.
        $repaired = [regex]::Replace($raw, '"(?:[^"\\]|\\.)*"', {
            param($match)

            $literal = $match.Value
            $content = $literal.Substring(1, $literal.Length - 2)

            if ([regex]::IsMatch($content, '\\(?![\\"/bfnrtu])')) {
                $content = $content -replace '\\', '\\'
            }

            return '"' + $content + '"'
        })
        try {
            $parsed = $repaired | ConvertFrom-Json
            Write-Log -Level WARN -Message "config.json contains unescaped backslashes; read it anyway. Double them (\\) to silence this."
        } catch {
            throw @"
config.json is not valid JSON ($Path): $($_.Exception.Message)

If the printer name is a network path, each backslash has to be doubled:
  "printerName": "\\\\Server\\ZDesigner GK420d"
The easiest fix is to run Install.bat and pick the printer from the list -
it writes the file correctly for you.
"@
        }
    }

    foreach ($property in $parsed.PSObject.Properties) {
        if ($config.Contains($property.Name)) {
            $config[$property.Name] = $property.Value
        }
    }

    if (-not $config.printerName) {
        throw "printerName is not set in $Path. Set it to the exact Windows printer name."
    }

    return $config
}

<#
.SYNOPSIS
    Where this machine's logs go.

.DESCRIPTION
    Beside config.json rather than beside the script. The script may live on a
    read-only network share that every PC runs the same copy of, while the
    config - and this machine's own log - are local to the PC.
#>
function Get-LogDirectory {
    $base = if ($script:ConfigPath) { Split-Path -Parent $script:ConfigPath } else { '' }
    if (-not $base) { $base = $script:ScriptDir }
    return (Join-Path $base 'logs')
}

function Get-LogPath {
    $logDir = Get-LogDirectory
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Join-Path $logDir ("helper-{0:yyyy-MM-dd}.log" -f (Get-Date))
}

function Write-Log {
    param(
        [string] $Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')]
        [string] $Level = 'INFO'
    )

    $line = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Level, $Message

    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        default { Write-Host $line }
    }

    try {
        Add-Content -LiteralPath (Get-LogPath) -Value $line -Encoding UTF8
    } catch {
        # Never let a logging failure take the printer offline.
    }
}

function Remove-OldLogs {
    param([int] $RetentionDays)

    if ($RetentionDays -le 0) { return }
    $logDir = Get-LogDirectory
    if (-not (Test-Path -LiteralPath $logDir)) { return }

    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -LiteralPath $logDir -Filter 'helper-*.log' -File |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        ForEach-Object {
            try { Remove-Item -LiteralPath $_.FullName -Force } catch { }
        }
}

# ---------------------------------------------------------------------------
# Environment checks
# ---------------------------------------------------------------------------

function Get-InstalledPrinters {
    try {
        return @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters)
    } catch {
        return @()
    }
}

function Get-PrinterShareName {
    param([string] $Name)
    # "\\Server\ZDesigner GK420d" -> "ZDesigner GK420d"
    $trimmed = ([string]$Name).TrimEnd('\')
    $lastSlash = $trimmed.LastIndexOf('\')
    if ($lastSlash -ge 0) { return $trimmed.Substring($lastSlash + 1) }
    return $trimmed
}

<#
.SYNOPSIS
    Match the configured printer name against what Windows actually has.

.DESCRIPTION
    A network printer is installed under its full UNC path
    ("\\Prec-FP2T753\ZDesigner GK420d"), but the name on the device, in its
    documentation and in everyone's head is the short one. Requiring the exact
    UNC string is a papercut with no upside, so a unique short-name match is
    accepted too.

    Ambiguity is never resolved by guessing: if the short name matches more
    than one installed printer, that is reported rather than picking one.

.OUTPUTS
    Hashtable with Found, Name (the exact name to print to), Reason, Matches.
#>
function Resolve-PrinterName {
    param([string] $PrinterName)

    $installed = @(Get-InstalledPrinters)
    $wanted = ([string]$PrinterName).Trim()

    if (-not $wanted) {
        return @{ Found = $false; Name = $null; Reason = 'no printer name is configured'; Matches = @() }
    }

    foreach ($candidate in $installed) {
        if ([string]::Equals($candidate, $wanted, [StringComparison]::OrdinalIgnoreCase)) {
            return @{ Found = $true; Name = $candidate; Reason = 'exact match'; Matches = @($candidate) }
        }
    }

    $wantedShare = Get-PrinterShareName -Name $wanted
    $byShare = @($installed | Where-Object {
        [string]::Equals((Get-PrinterShareName -Name $_), $wantedShare, [StringComparison]::OrdinalIgnoreCase)
    })

    if ($byShare.Count -eq 1) {
        return @{ Found = $true; Name = $byShare[0]; Reason = 'matched on the printer share name'; Matches = $byShare }
    }

    if ($byShare.Count -gt 1) {
        return @{
            Found = $false
            Name = $null
            Reason = "more than one installed printer is called '$wantedShare' - set printerName to the full name of the one you want"
            Matches = $byShare
        }
    }

    return @{ Found = $false; Name = $null; Reason = 'no installed printer has that name'; Matches = @() }
}

function Test-PrinterAvailable {
    param([string] $PrinterName)
    return (Resolve-PrinterName -PrinterName $PrinterName).Found
}

function Test-LabelFolder {
    param([string] $Folder)

    try {
        return [System.IO.Directory]::Exists($Folder)
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# Printing
# ---------------------------------------------------------------------------

$script:OnPrintPage = {
    param($sender, $e)

    $image = $script:PrintImage
    $mode = $script:ScaleMode
    $rotate = $script:AutoRotate

    # PageBounds and the graphics surface are both in hundredths of an inch.
    $pageWidth = $e.PageBounds.Width
    $pageHeight = $e.PageBounds.Height

    # The BMP's own DPI gives its intended physical size.
    $dpiX = if ($image.HorizontalResolution -gt 0) { $image.HorizontalResolution } else { 96 }
    $dpiY = if ($image.VerticalResolution -gt 0) { $image.VerticalResolution } else { 96 }
    $imageWidth = ($image.Width / $dpiX) * 100
    $imageHeight = ($image.Height / $dpiY) * 100

    $quarterTurn = $false
    if ($rotate) {
        $imageIsWide = $imageWidth -gt $imageHeight
        $pageIsWide = $pageWidth -gt $pageHeight
        if ($imageIsWide -ne $pageIsWide) {
            $quarterTurn = $true
            $swap = $imageWidth; $imageWidth = $imageHeight; $imageHeight = $swap
        }
    }

    switch ($mode) {
        'actual' { $scale = 1.0 }
        'fitDown' {
            $scale = [Math]::Min($pageWidth / $imageWidth, $pageHeight / $imageHeight)
            if ($scale -gt 1.0) { $scale = 1.0 }
        }
        default {
            $scale = [Math]::Min($pageWidth / $imageWidth, $pageHeight / $imageHeight)
        }
    }

    $drawWidth = $imageWidth * $scale
    $drawHeight = $imageHeight * $scale
    $offsetX = ($pageWidth - $drawWidth) / 2
    $offsetY = ($pageHeight - $drawHeight) / 2

    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    if ($quarterTurn) {
        # Rotate about the page centre, then draw as if the page were turned.
        $e.Graphics.TranslateTransform($pageWidth / 2, $pageHeight / 2)
        $e.Graphics.RotateTransform(90)
        $e.Graphics.TranslateTransform(-$pageHeight / 2, -$pageWidth / 2)
        $rect = New-Object System.Drawing.RectangleF(
            [float]$offsetY, [float]$offsetX, [float]$drawHeight, [float]$drawWidth)
    } else {
        $rect = New-Object System.Drawing.RectangleF(
            [float]$offsetX, [float]$offsetY, [float]$drawWidth, [float]$drawHeight)
    }

    $e.Graphics.DrawImage($image, $rect)
    $e.HasMorePages = $false
}

function Invoke-PrintBitmap {
    param(
        [string] $Path,
        [string] $PrinterName,
        [string] $DocumentName,
        [hashtable] $Config
    )

    # Read into memory first so the print never holds a lock on a file that
    # sits on a network share.
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $stream = New-Object System.IO.MemoryStream(, $bytes)

    $document = $null
    try {
        $script:PrintImage = [System.Drawing.Image]::FromStream($stream)
        $script:ScaleMode = $Config.scaleMode
        $script:AutoRotate = [bool]$Config.autoRotate

        $document = New-Object System.Drawing.Printing.PrintDocument
        $document.PrinterSettings.PrinterName = $PrinterName
        $document.DocumentName = $DocumentName

        if (-not $document.PrinterSettings.IsValid) {
            throw "Printer '$PrinterName' was rejected by Windows."
        }

        $margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
        $document.DefaultPageSettings.Margins = $margins

        # Without StandardPrintController, .NET shows a progress dialog.
        $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
        $document.add_PrintPage($script:OnPrintPage)

        $document.Print()
    } finally {
        if ($document) {
            try { $document.remove_PrintPage($script:OnPrintPage) } catch { }
            $document.Dispose()
        }
        if ($script:PrintImage) {
            $script:PrintImage.Dispose()
            $script:PrintImage = $null
        }
        $stream.Dispose()
    }
}

# ---------------------------------------------------------------------------
# Request handling
# ---------------------------------------------------------------------------

function New-PrintResult {
    param(
        [string[]] $Printed = @(),
        [string[]] $Missing = @(),
        # Deliberately untyped: [string]$null becomes '', and the contract with
        # the extension is that "error" is null when nothing went wrong.
        $ErrorMessage = $null,
        $ErrorCode = $null
    )

    [ordered]@{
        printed   = @($Printed)
        missing   = @($Missing)
        error     = $ErrorMessage
        errorCode = $ErrorCode
    }
}

function Invoke-PrintRequest {
    param(
        [string[]] $PartCodes,
        [hashtable] $Config
    )

    if (-not $PartCodes -or $PartCodes.Count -eq 0) {
        return New-PrintResult -ErrorMessage 'No part codes were supplied.' -ErrorCode 'BAD_REQUEST'
    }

    # These two checks come first and fail the whole batch: a disconnected
    # drive and a missing printer are setup problems, not per-label problems,
    # and they need different fixes than "that label was never generated".
    if (-not (Test-LabelFolder -Folder $Config.labelFolder)) {
        Write-Log -Level ERROR -Message "Label folder unreachable: $($Config.labelFolder)"
        return New-PrintResult -ErrorMessage "The label folder '$($Config.labelFolder)' is not reachable." -ErrorCode 'FOLDER_UNREACHABLE'
    }

    $printer = Resolve-PrinterName -PrinterName $Config.printerName
    if (-not $printer.Found) {
        Write-Log -Level ERROR -Message "Printer not found: $($Config.printerName) - $($printer.Reason)"
        return New-PrintResult -ErrorMessage "Printer '$($Config.printerName)' was not found on this PC: $($printer.Reason)." -ErrorCode 'PRINTER_NOT_FOUND'
    }

    if ($printer.Name -ne $Config.printerName) {
        Write-Log -Message "Printing to '$($printer.Name)' ($($printer.Reason) for configured name '$($Config.printerName)')."
    }

    $printed = New-Object System.Collections.Generic.List[string]
    $missing = New-Object System.Collections.Generic.List[string]
    $failed = New-Object System.Collections.Generic.List[string]
    $alreadySeen = New-Object System.Collections.Generic.HashSet[string] ([StringComparer]::OrdinalIgnoreCase)

    foreach ($partCode in $PartCodes) {
        if ($null -eq $partCode) { continue }
        $code = ([string]$partCode).Trim()

        if ($code -notmatch $script:PartCodePattern) {
            Write-Log -Level WARN -Message "Rejected part code '$code' (unusable as a filename)."
            $missing.Add($code) | Out-Null
            continue
        }

        # The extension dedupes, but never print twice if it did not.
        if (-not $alreadySeen.Add($code)) {
            Write-Log -Level WARN -Message "Duplicate part code '$code' in one request; printed once."
            continue
        }

        $file = Join-Path $Config.labelFolder ($code + '.bmp')
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            $missing.Add($code) | Out-Null
            continue
        }

        try {
            Invoke-PrintBitmap -Path $file -PrinterName $printer.Name -DocumentName "Label $code" -Config $Config
            $printed.Add($code) | Out-Null
            Write-Log -Message "Printed $code.bmp"
        } catch {
            $failed.Add($code) | Out-Null
            Write-Log -Level ERROR -Message "Failed to print $code.bmp - $($_.Exception.Message)"
        }
    }

    $result = New-PrintResult -Printed $printed.ToArray() -Missing $missing.ToArray()

    if ($failed.Count -gt 0) {
        $result.error = "Windows refused to print: $($failed -join ', '). See the helper log for detail."
        $result.errorCode = 'PRINT_FAILED'
    }

    return $result
}

function Get-HealthPayload {
    param([hashtable] $Config)

    $printerStatus = Resolve-PrinterName -PrinterName $Config.printerName

    [ordered]@{
        status          = 'ok'
        version         = $script:Version
        printerName     = $Config.printerName
        printerFound    = $printerStatus.Found
        printerResolved = $printerStatus.Name
        labelFolder     = $Config.labelFolder
        folderReachable = (Test-LabelFolder -Folder $Config.labelFolder)
        warnThreshold   = $Config.warnThreshold
    }
}

# ---------------------------------------------------------------------------
# Minimal HTTP over TcpListener
# ---------------------------------------------------------------------------

function Read-HttpRequest {
    param([System.Net.Sockets.TcpClient] $Client)

    $stream = $Client.GetStream()
    $stream.ReadTimeout = 10000

    $buffer = New-Object byte[] 8192
    $received = New-Object System.Collections.Generic.List[byte]
    $headerEnd = -1

    while ($headerEnd -lt 0) {
        $count = $stream.Read($buffer, 0, $buffer.Length)
        if ($count -le 0) { return $null }
        for ($i = 0; $i -lt $count; $i++) { $received.Add($buffer[$i]) }

        for ($i = 3; $i -lt $received.Count; $i++) {
            if ($received[$i - 3] -eq 13 -and $received[$i - 2] -eq 10 -and
                $received[$i - 1] -eq 13 -and $received[$i] -eq 10) {
                $headerEnd = $i
                break
            }
        }

        if ($received.Count -gt 1048576) { return $null }
    }

    $headerBytes = $received.GetRange(0, $headerEnd + 1).ToArray()
    $headerText = [System.Text.Encoding]::ASCII.GetString($headerBytes)
    $lines = $headerText -split "`r`n"

    $requestLine = ($lines[0] -split ' ')
    if ($requestLine.Count -lt 2) { return $null }

    $headers = @{}
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $separator = $lines[$i].IndexOf(':')
        if ($separator -gt 0) {
            $name = $lines[$i].Substring(0, $separator).Trim().ToLowerInvariant()
            $headers[$name] = $lines[$i].Substring($separator + 1).Trim()
        }
    }

    $contentLength = 0
    if ($headers.ContainsKey('content-length')) {
        [int]::TryParse($headers['content-length'], [ref] $contentLength) | Out-Null
    }

    $bodyBytes = New-Object System.Collections.Generic.List[byte]
    $alreadyRead = $received.Count - ($headerEnd + 1)
    if ($alreadyRead -gt 0) {
        $bodyBytes.AddRange($received.GetRange($headerEnd + 1, $alreadyRead))
    }

    while ($bodyBytes.Count -lt $contentLength) {
        $count = $stream.Read($buffer, 0, [Math]::Min($buffer.Length, $contentLength - $bodyBytes.Count))
        if ($count -le 0) { break }
        for ($i = 0; $i -lt $count; $i++) { $bodyBytes.Add($buffer[$i]) }
    }

    [pscustomobject]@{
        Method  = $requestLine[0].ToUpperInvariant()
        Path    = ($requestLine[1] -split '\?')[0]
        Headers = $headers
        Body    = [System.Text.Encoding]::UTF8.GetString($bodyBytes.ToArray())
    }
}

function Write-HttpResponse {
    param(
        [System.Net.Sockets.TcpClient] $Client,
        [int] $StatusCode,
        [string] $StatusText,
        [string] $Body,
        [string] $AllowOrigin = '*'
    )

    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)

    $headerLines = @(
        "HTTP/1.1 $StatusCode $StatusText",
        'Content-Type: application/json; charset=utf-8',
        "Content-Length: $($bodyBytes.Length)",
        "Access-Control-Allow-Origin: $AllowOrigin",
        'Access-Control-Allow-Methods: GET, POST, OPTIONS',
        'Access-Control-Allow-Headers: Content-Type',
        # Chrome's Private Network Access preflight for public -> loopback.
        'Access-Control-Allow-Private-Network: true',
        'Cache-Control: no-store',
        'Connection: close'
    )

    $header = ($headerLines -join "`r`n") + "`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)

    $stream = $Client.GetStream()
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($bodyBytes, 0, $bodyBytes.Length)
    $stream.Flush()
}

function Resolve-AllowOrigin {
    param([hashtable] $Config, $Request)

    $allowed = @($Config.allowedOrigins)
    if ($allowed -contains '*') { return '*' }

    $origin = ''
    if ($Request -and $Request.Headers.ContainsKey('origin')) {
        $origin = $Request.Headers['origin']
    }
    if ($origin -and ($allowed -contains $origin)) { return $origin }

    return 'null'
}

function Invoke-Router {
    param($Request, [hashtable] $Config)

    if ($Request.Method -eq 'OPTIONS') {
        return @{ Status = 204; Text = 'No Content'; Body = '' }
    }

    if ($Request.Method -eq 'GET' -and $Request.Path -eq '/health') {
        return @{ Status = 200; Text = 'OK'; Body = (Get-HealthPayload -Config $Config | ConvertTo-Json -Depth 4 -Compress) }
    }

    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/print') {
        $partCodes = @()
        try {
            $payload = $Request.Body | ConvertFrom-Json
            if ($payload -and $payload.PSObject.Properties.Name -contains 'partCodes') {
                $partCodes = @($payload.partCodes)
            }
        } catch {
            $body = New-PrintResult -ErrorMessage 'The request body was not valid JSON.' -ErrorCode 'BAD_REQUEST' |
                ConvertTo-Json -Depth 4 -Compress
            return @{ Status = 400; Text = 'Bad Request'; Body = $body }
        }

        Write-Log -Message "Print request: $($partCodes.Count) part code(s) - $($partCodes -join ', ')"
        $result = Invoke-PrintRequest -PartCodes $partCodes -Config $Config
        Write-Log -Message "Result: printed $($result.printed.Count), missing $($result.missing.Count)$(if ($result.errorCode) { ", error $($result.errorCode)" })"

        return @{ Status = 200; Text = 'OK'; Body = ($result | ConvertTo-Json -Depth 4 -Compress) }
    }

    $notFound = [ordered]@{ error = 'Unknown endpoint'; errorCode = 'NOT_FOUND' } | ConvertTo-Json -Compress
    return @{ Status = 404; Text = 'Not Found'; Body = $notFound }
}

function Start-HelperServer {
    param([hashtable] $Config)

    $address = [System.Net.IPAddress]::Parse('127.0.0.1')
    $listener = New-Object System.Net.Sockets.TcpListener($address, [int]$Config.port)

    try {
        $listener.Start()
    } catch {
        Write-Log -Level ERROR -Message "Could not listen on 127.0.0.1:$($Config.port). Another program may already be using that port. $($_.Exception.Message)"
        throw
    }

    Write-Log -Message "Innergy Label Helper $($script:Version) listening on http://127.0.0.1:$($Config.port)"
    Write-Log -Message "Printer: $($Config.printerName)"
    Write-Log -Message "Label folder: $($Config.labelFolder)"

    try {
        while ($true) {
            $client = $listener.AcceptTcpClient()
            try {
                $request = Read-HttpRequest -Client $client
                if ($null -eq $request) { continue }

                $allowOrigin = Resolve-AllowOrigin -Config $Config -Request $request
                $response = Invoke-Router -Request $request -Config $Config
                Write-HttpResponse -Client $client -StatusCode $response.Status -StatusText $response.Text -Body $response.Body -AllowOrigin $allowOrigin
            } catch {
                Write-Log -Level ERROR -Message "Request failed: $($_.Exception.Message)"
                try {
                    $body = New-PrintResult -ErrorMessage $_.Exception.Message -ErrorCode 'INTERNAL_ERROR' | ConvertTo-Json -Depth 4 -Compress
                    Write-HttpResponse -Client $client -StatusCode 500 -StatusText 'Internal Server Error' -Body $body
                } catch { }
            } finally {
                $client.Close()
            }
        }
    } finally {
        $listener.Stop()
    }
}

# ---------------------------------------------------------------------------
# Self test
# ---------------------------------------------------------------------------

function Invoke-SelfTest {
    param([hashtable] $Config, [string] $PartCode)

    $problems = 0

    Write-Host ''
    Write-Host "Innergy Label Helper $($script:Version) - self test" -ForegroundColor Cyan
    Write-Host ('-' * 54)
    Write-Host "Config file : $script:ConfigPath"
    Write-Host "Port        : $($Config.port)"
    Write-Host ''

    Write-Host "Printer     : $($Config.printerName)"
    $printer = Resolve-PrinterName -PrinterName $Config.printerName
    if ($printer.Found) {
        if ($printer.Name -ne $Config.printerName) {
            Write-Host "              FOUND as '$($printer.Name)'" -ForegroundColor Green
            Write-Host "              ($($printer.Reason))" -ForegroundColor DarkGray
        } else {
            Write-Host '              FOUND' -ForegroundColor Green
        }
    } else {
        $problems++
        Write-Host "              NOT FOUND - $($printer.Reason)" -ForegroundColor Red
        Write-Host '              Installed printers on this PC:'
        foreach ($installed in Get-InstalledPrinters) { Write-Host "                - $installed" }
        Write-Host ''
        Write-Host '              Run Install.bat and pick the printer by number - it' -ForegroundColor Yellow
        Write-Host '              writes config.json correctly, including any backslashes.' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host "Label folder: $($Config.labelFolder)"
    if (Test-LabelFolder -Folder $Config.labelFolder) {
        $count = @(Get-ChildItem -LiteralPath $Config.labelFolder -Filter '*.bmp' -File -ErrorAction SilentlyContinue).Count
        Write-Host "              REACHABLE ($count .bmp files)" -ForegroundColor Green
    } else {
        $problems++
        Write-Host '              NOT REACHABLE - is the mapped drive connected?' -ForegroundColor Red
    }

    if ($PartCode) {
        Write-Host ''
        Write-Host "Test print  : $PartCode"
        $result = Invoke-PrintRequest -PartCodes @($PartCode) -Config $Config
        if ($result.printed.Count -gt 0) {
            Write-Host '              SENT TO PRINTER' -ForegroundColor Green
        } else {
            $problems++
            $reason = if ($result.error) { $result.error } else { "$PartCode.bmp was not found in the label folder." }
            Write-Host "              FAILED - $reason" -ForegroundColor Red
        }
    }

    Write-Host ''
    if ($problems -eq 0) {
        Write-Host 'All checks passed.' -ForegroundColor Green
    } else {
        Write-Host "$problems problem(s) found - see above." -ForegroundColor Red
    }
    Write-Host ''

    return $problems
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

try {
    $config = Read-Config -Path $ConfigPath
} catch {
    Write-Host ''
    Write-Host "Configuration error:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    if (-not $SelfTest) { Start-Sleep -Seconds 10 }
    exit 1
}

Remove-OldLogs -RetentionDays ([int]$config.logRetentionDays)

if ($SelfTest) {
    exit (Invoke-SelfTest -Config $config -PartCode $PrintTest)
}

Start-HelperServer -Config $config
