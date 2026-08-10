@echo off
REM Checks this PC's setup: is the printer installed, is the label folder
REM reachable, and does the config make sense. Prints nothing unless you pass
REM a part code, e.g.:  Test-Setup.bat 7604HA2K

setlocal
set "INSTALLED=%LOCALAPPDATA%\InnergyLabelHelper\InnergyLabelHelper.ps1"

if exist "%INSTALLED%" (
    set "TARGET=%INSTALLED%"
) else (
    set "TARGET=%~dp0InnergyLabelHelper.ps1"
)

if "%~1"=="" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET%" -SelfTest
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET%" -SelfTest -PrintTest "%~1"
)

echo.
pause
