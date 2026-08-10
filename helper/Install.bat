@echo off
REM Double-click this to install the Innergy Label Helper on this PC.
REM No administrator rights are needed.

setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Helper.ps1"

echo.
pause
