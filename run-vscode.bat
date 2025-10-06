
@echo off

::###################################################################################
:: activate environment
::###################################################################################

:: check and download potable-cmd.bat (CRLF)
if not exist "%~dp0potable-cmd.bat" (
    echo potable-cmd.bat not found. Downloading...
    curl -L -o "%~dp0potable-cmd.bat" "https://github.com/cotab-org/cotab/raw/refs/heads/main/potable-cmd.bat"
    if ERRORLEVEL 1 goto :ERROR
    
    powershell -Command "Get-Content '%~dp0potable-cmd.bat' -Raw | Set-Content '%~dp0potable-cmd.bat' -Encoding ASCII"
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
        call :RUN_VSCODE_INTERNAL "%%~fI"
        exit /b 0
    )
    echo 'code' command not found on PATH.
exit /b 1

:RUN_VSCODE_INTERNAL
    for %%I in ("%~1") do set "CODE_BIN_DIR=%%~dpI"
    for %%I in ("%CODE_BIN_DIR%..") do set "VSCODE_EXE=%%~fI\Code.exe"
    if exist "%VSCODE_EXE%" (
        start "" "%VSCODE_EXE%" "%~dp0"
    ) else (
        start code "%~dp0"
    )
exit /b 0
