@echo off
cd /d "%~dp0"
echo Building AI Short Drama Studio 1.3.0 ... > build-1.3.0.log
node scripts\package-win.mjs >> build-1.3.0.log 2>&1
echo EXIT=%ERRORLEVEL% >> build-1.3.0.log
