@echo off
REM Double-click this from the network share to set this PC up to run the
REM helper straight from the share, rather than copying it locally.
REM
REM Only config.json and this machine's logs stay on the PC - the printer
REM differs per machine, so the config has to be local. Updating the share
REM then updates every PC at their next login.
REM
REM Run it from a UNC path (\\server\share\...) rather than a mapped drive:
REM drive letters are per-session and may not exist at login.

setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Helper.ps1" -FromShare %*

echo.
pause
