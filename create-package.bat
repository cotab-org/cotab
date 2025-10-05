@echo off

call "%~dp0potable-cmd.bat"
if ERRORLEVEL 1 goto :ERROR

echo ### npm install ...
call npm install
if ERRORLEVEL 1 goto :ERROR

echo ### npx vsce package ...
call npx vsce package
if ERRORLEVEL 1 goto :ERROR

echo ####################
echo #   %~n0 success
echo ####################
echo success
pause
exit /b 0

:ERROR
	echo ###################
    echo #   %~n0 failure
	echo ###################
	pause
exit /b 1
