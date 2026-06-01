@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

if exist "%SCRIPT_DIR%install.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1" %*
  exit /b %errorlevel%
)

echo install.ps1 was not found next to install.cmd.
echo.
echo Run this from Windows PowerShell instead:
echo   irm https://raw.githubusercontent.com/gambit-agent/gambit/main/install.ps1 ^| iex
exit /b 1
