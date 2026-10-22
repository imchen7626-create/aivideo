@echo off
cd /d "%~dp0"
set STUDIO_TEST_DATA=%~dp0work\final-120-smoke
release\win-unpacked\AIShortDramaStudio.exe --smoke-test
echo SMOKE_EXIT=%ERRORLEVEL% > work\final-120-smoke-exit.txt
start "" release\win-unpacked\AIShortDramaStudio.exe --ui-test
