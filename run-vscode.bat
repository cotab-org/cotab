
@echo off
setlocal enabledelayedexpansion

if not exist "%~dp0potable-cmd.bat" (
    echo potable-cmd.bat not found. Downloading...
    curl -L -o "%~dp0potable-cmd.bat" "https://github.com/cotab-org/cotab/raw/refs/heads/main/potable-cmd.bat" --crlf
    if ERRORLEVEL 1 goto :ERROR
)
call "%~dp0potable-cmd.bat"
if ERRORLEVEL 1 goto :ERROR

echo on
for /f "delims=" %%I in ('where code 2^>NUL') do (
    for %%I in ("%%~fI") do set "CODE_BIN_DIR=%%~dpI"
    for %%I in ("!CODE_BIN_DIR!..") do set "VSCODE_EXE=%%~fI\Code.exe"
    if exist "!VSCODE_EXE!" (
        start "" "!VSCODE_EXE!" "%~dp0"
    ) else (
        start code "%~dp0"
    )
    exit /b 0
)
echo 'code' command not found on PATH.

:ERROR
	echo ###################
    echo #   %~n0 failure
	echo ###################
	pause
exit /b 1
