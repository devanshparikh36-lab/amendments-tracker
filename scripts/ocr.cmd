@echo off
REM Reads a slice of the scanned-PDF backlog: the 284 stored documents that are images with no text layer,
REM about 14,000 pages at roughly five seconds each.
REM
REM Run hourly by the "Regulation Tracker OCR" task, on mains power only, because this is background catch-up
REM rather than urgent work. Resumable by construction: every attachment attempted is marked in the database,
REM so stopping at any moment -- closing the laptop included -- costs at most the one file in flight.

setlocal
set "REPO=%~dp0.."
set "LOGDIR=%LOCALAPPDATA%\RegulationTracker"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\ocr.log"

REM Keep the log bounded; OCR is chatty on poor scans.
for %%F in ("%LOG%") do if %%~zF GTR 5000000 del "%LOG%"

echo. >> "%LOG%"
echo ======== ocr pass %DATE% %TIME% ======== >> "%LOG%"

cd /d "%REPO%\services\pipeline" || exit /b 1
".venv\Scripts\python.exe" cli.py ocr --minutes 45 >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo ======== ocr pass finished %DATE% %TIME% (exit %RC%) ======== >> "%LOG%"
exit /b %RC%
