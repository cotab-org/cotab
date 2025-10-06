
@echo off

::###################################################################################
:: activate environment
::###################################################################################

:: check and download potable-cmd.bat
if not exist "%~dp0potable-cmd.bat" (
    echo potable-cmd.bat not found. Downloading...
    curl -L -o "%~dp0potable-cmd.bat" "https://github.com/cotab-org/cotab/raw/refs/heads/main/potable-cmd.bat"
    if ERRORLEVEL 1 goto :ERROR
)

:: activate environment
call "%~dp0potable-cmd.bat"
if ERRORLEVEL 1 goto :ERROR

::###################################################################################
:: main
::###################################################################################

goto :RUN_VSCODE
if ERRORLEVEL 1 goto :ERROR
exit /b 0

::###################################################################################
:: functions
::###################################################################################

:ERROR
	echo ###################
    echo #   %~n0 failure
	echo ###################
	pause
exit /b 1

:RUN_VSCODE
    :: search code command and start vscode
    for /f "delims=" %%I in ('where code 2^>NUL') do (
        set "CODE_CMD=%%~fI"
        goto :RUN_VSCODE_INTERNAL
        exit /b 0
    )
    echo 'code' command not found on PATH.
exit /b 1

:RUN_VSCODE_INTERNAL
    for %%I in ("%CODE_CMD%") do set "CODE_BIN_DIR=%%~dpI"
    for %%I in ("%CODE_BIN_DIR%..") do set "VSCODE_EXE=%%~fI\Code.exe"
    if exist "%VSCODE_EXE%" (
        start "" "%VSCODE_EXE%" "%~dp0"
    ) else (
        start code "%~dp0"
    )
exit /b 0