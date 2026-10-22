@echo off
cd /d "%~dp0"
echo Building AI Short Drama Studio ... > build.log
node scripts\package-win.mjs >> build.log 2>&1
echo EXIT=%ERRORLEVEL% >> build.log
