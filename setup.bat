@echo off
setlocal

REM Source checkout bootstrap for Windows CMD.

cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo Error: Bun is required. Install it from https://bun.sh, then rerun setup.bat.
  exit /b 1
)

bun install
if errorlevel 1 exit /b %errorlevel%

bun run tsc --noEmit
if errorlevel 1 exit /b %errorlevel%

bun build --compile --outfile=gambit.exe src/gambit.tsx
if errorlevel 1 exit /b %errorlevel%

if "%GAMBIT_BIN_DIR%"=="" (
  set "BIN_DIR=%USERPROFILE%\.local\bin"
) else (
  set "BIN_DIR=%GAMBIT_BIN_DIR%"
)

if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
copy /Y gambit.exe "%BIN_DIR%\gambit.exe" >nul

echo.
echo Installed gambit.exe to %BIN_DIR%
echo Add that directory to PATH before running gambit from a new terminal.
