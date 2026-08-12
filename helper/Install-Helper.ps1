<#
.SYNOPSIS
    Installs the Innergy Label Helper on this PC.

.DESCRIPTION
    Copies the helper into the user's local app data folder, creates
    config.json from the sample on first install, adds a Startup shortcut so it
    runs at login, and starts it.

    Needs no administrator rights: everything lives under the current user's
    profile, and the helper listens on loopback only.

.PARAMETER PrinterName
    Exact Windows printer name to print labels to. Prompted for if omitted on a
    first install.

.PARAMETER LabelFolder
    Folder holding the [PartCode].bmp files. Defaults to T:\NC Output\Labels.

.PARAMETER FromShare
    Run the helper straight from where this script already lives - a read-only
    network share - instead of copying it to this PC. Only config.json and this
    machine's logs stay local, so updating the share updates every PC at their
    next login.

    Use a UNC path (\\server\share\...) rather than a mapped drive letter:
    drive mappings are per-session and may not exist when the shortcut runs.

.PARAMETER NoStart
    Install without launching the helper afterwards.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Install-Helper.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Install-Helper.ps1 -PrinterName "Zebra ZD420"

.EXAMPLE
    \\server\share\helper\Install.bat -FromShare
#>

[CmdletBinding()]
param(
    [string] $PrinterName,
    [string] $LabelFolder,
    [switch] $FromShare,
    [switch] $NoStart
)

$ErrorActionPreference = 'Stop'

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:LOCALAPPDATA 'InnergyLabelHelper'
$configPath = Join-Path $installDir 'config.json'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Innergy Label Helper.lnk'

# -FromShare leaves the script where it is and points the shortcut at it, so
# one folder serves every PC. config.json and the logs stay local either way.
$scriptPath = if ($FromShare) {
    Join-Path $sourceDir 'InnergyLabelHelper.ps1'
} else {
    Join-Path $installDir 'InnergyLabelHelper.ps1'
}

function Write-Step {
    param([string] $Message)
    Write-Host "  $Message"
}

Write-Host ''
Write-Host 'Installing Innergy Label Helper' -ForegroundColor Cyan
Write-Host ('-' * 40)

# --- stop anything already running -----------------------------------------
$running = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*InnergyLabelHelper.ps1*' }
foreach ($process in $running) {
    Write-Step "Stopping the running helper (PID $($process.ProcessId))"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($running) { Start-Sleep -Seconds 1 }

# --- place the script -------------------------------------------------------
if (-not (Test-Path -LiteralPath $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

if ($FromShare) {
    Write-Step "Running from $sourceDir (not copied)"
    if ($sourceDir -notlike '\\*') {
        Write-Host ''
        Write-Host '  NOTE: that is not a UNC path. A mapped drive letter may not be' -ForegroundColor Yellow
        Write-Host '  available when the shortcut runs at login - prefer \\server\share\...' -ForegroundColor Yellow
        Write-Host ''
    }
} else {
    Write-Step "Copying to $installDir"
    Copy-Item -LiteralPath (Join-Path $sourceDir 'InnergyLabelHelper.ps1') -Destination $installDir -Force
    Copy-Item -LiteralPath (Join-Path $sourceDir 'config.sample.json') -Destination $installDir -Force
}

# --- config -----------------------------------------------------------------
if (Test-Path -LiteralPath $configPath) {
    Write-Step 'Keeping the existing config.json'
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($PrinterName) { $config.printerName = $PrinterName }
    if ($LabelFolder) { $config.labelFolder = $LabelFolder }
} else {
    Write-Step 'Creating config.json'
    $config = Get-Content -LiteralPath (Join-Path $sourceDir 'config.sample.json') -Raw -Encoding UTF8 | ConvertFrom-Json

    if (-not $PrinterName) {
        Write-Host ''
        Write-Host '  Printers installed on this PC:' -ForegroundColor Yellow
        Add-Type -AssemblyName System.Drawing
        $printers = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters)
        for ($i = 0; $i -lt $printers.Count; $i++) {
            Write-Host ("    [{0}] {1}" -f ($i + 1), $printers[$i])
        }
        Write-Host ''
        $answer = Read-Host '  Enter the number (or full name) of the Zebra label printer'
        $index = 0
        if ([int]::TryParse($answer, [ref] $index) -and $index -ge 1 -and $index -le $printers.Count) {
            $PrinterName = $printers[$index - 1]
        } else {
            $PrinterName = $answer
        }
    }

    $config.printerName = $PrinterName
    if ($LabelFolder) { $config.labelFolder = $LabelFolder }
}

$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding UTF8
Write-Step "Printer      : $($config.printerName)"
Write-Step "Label folder : $($config.labelFolder)"
Write-Step "Port         : $($config.port)"

# --- run at login -----------------------------------------------------------
Write-Step 'Adding the Startup shortcut'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# -ConfigPath is always explicit: with -FromShare the script and the config
# are in different places, and being explicit costs nothing when they are not.
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -ConfigPath `"$configPath`""
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = 'Prints Innergy external part labels to the local Zebra printer'
$shortcut.WindowStyle = 7   # start minimised
$shortcut.Save()

# --- check ------------------------------------------------------------------
Write-Host ''
& $shortcut.TargetPath -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ConfigPath $configPath -SelfTest
$selfTestFailures = $LASTEXITCODE

# --- start ------------------------------------------------------------------
if (-not $NoStart) {
    Write-Step 'Starting the helper'
    Start-Process -FilePath $shortcut.TargetPath `
        -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
                        '-File', "`"$scriptPath`"", '-ConfigPath', "`"$configPath`"") `
        -WorkingDirectory $installDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

Write-Host ''
if ($selfTestFailures -eq 0) {
    Write-Host 'Done. The helper is installed and will start automatically at login.' -ForegroundColor Green
} else {
    Write-Host 'Installed, but the self test found problems (see above).' -ForegroundColor Yellow
    Write-Host "Fix them, then edit $configPath if needed and run Install-Helper again." -ForegroundColor Yellow
}
Write-Host ''
Write-Host "Script:      $scriptPath"
Write-Host "Config file: $configPath"
Write-Host "Logs:        $(Join-Path $installDir 'logs')"
if ($FromShare) {
    Write-Host ''
    Write-Host 'Updating the share now updates this PC at its next login.' -ForegroundColor Cyan
    Write-Host 'If the share is unreachable at login, the helper will not start.' -ForegroundColor Yellow
}
Write-Host ''
