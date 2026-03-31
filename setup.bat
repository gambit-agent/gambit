@echo off
REM Batch setup script for Gambit CLI command

echo Setting up Gambit CLI command...

REM Create the gambit.bat file in current directory
echo @echo off > gambit.bat
echo cd /d %~dp0 >> gambit.bat
echo bun run . >> gambit.bat

REM Move to a directory in PATH (if possible)
if exist "C:\Windows\System32\" (
    copy gambit.bat C:\Windows\System32\gambit.bat >nul 2>&1
    if exist "C:\Windows\System32\gambit.bat" (
        echo Created gambit.bat in C:\Windows\System32
        del gambit.bat
        echo Setup complete! You can now run 'gambit' from anywhere.
    ) else (
        echo Could not create system-wide shortcut. 
        echo You can manually copy gambit.bat to a directory in your PATH.
    )
) else (
    echo Created gambit.bat in current directory.
    echo You can run it with .\gambit.bat or move it to a directory in your PATH.
)

pause
