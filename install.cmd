@echo off
setlocal

echo Gambit does not currently publish native Windows release binaries.
echo.
echo Recommended Windows install:
echo   1. Open WSL.
echo   2. Run:
echo      curl -fsSL https://raw.githubusercontent.com/sergiomasellis/gambit-cli/main/install ^| bash
echo.
echo Source checkout install with Bun:
echo   bun install
echo   bun run tsc --noEmit
echo   bun run src/gambit.tsx
echo.
echo If you are working from this repository on Windows, run setup.bat.

exit /b 1
