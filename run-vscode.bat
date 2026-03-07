
@echo off

set "EDITOR_NAME=%~1"
if "%EDITOR_NAME%"=="" set "EDITOR_NAME=code"

::###################################################################################
:: activate environment
::###################################################################################

:: check and download potable-cmd.bat (CRLF)
if not exist "%~dp0potable-cmd.bat" (
    echo potable-cmd.bat not found. Downloading...
    curl -L -o "%~dp0potable-cmd.bat" "https://github.com/cotab-org/cotab/raw/refs/heads/main/potable-cmd.bat"
    if ERRORLEVEL 1 goto :ERROR
    
    powershell -Command "(Get-Content '%~dp0potable-cmd.bat' -Raw) -replace '`r?`n', \"`r`n\" | Set-Content '%~dp0potable-cmd.bat' -Encoding ASCII"
)

:: activate environment
call "%~dp0potable-cmd.bat"
if ERRORLEVEL 1 goto :ERROR

::###################################################################################
:: main
::###################################################################################

goto :LAUNCH_EDITOR "%EDITOR_NAME%"
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

:LAUNCH_EDITOR
    set "_LAUNCH_EDITOR_NAME=%~1"
    if "%_LAUNCH_EDITOR_NAME%"=="" set "_LAUNCH_EDITOR_NAME=code"

    for /f "delims=" %%I in ('where.exe "%_LAUNCH_EDITOR_NAME%.cmd" 2^>NUL') do (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%%~I' -ArgumentList '\"%~dp0\"' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
        if ERRORLEVEL 1 exit /b 1
        exit /b 0
    )

exit /b 1

