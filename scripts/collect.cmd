@echo off
REM Runs the full collection from this machine's residential connection.
REM
REM Invoked by the "Regulation Tracker collection" scheduled task. Exists because GitHub-hosted runners cannot
REM do this job: the free Actions allowance (2,000 min/month on a private repo) is exhausted around the 8th of
REM every month by a ~1h run four times a day, and five of the twelve sources return zero from those runners
REM while returning full counts from here.
REM
REM cli.py run exits non-zero if any adapter failed, so the task's Last Run Result is a real health signal:
REM 0x0 means every collector worked, anything else means read the log.

setlocal
set "REPO=%~dp0.."
set "LOGDIR=%LOCALAPPDATA%\RegulationTracker"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\collect.log"

REM Keep the log from growing without bound: past ~5 MB, start again.
for %%F in ("%LOG%") do if %%~zF GTR 5000000 del "%LOG%"

echo. >> "%LOG%"
echo ======== run started %DATE% %TIME% ======== >> "%LOG%"

cd /d "%REPO%\services\pipeline" || exit /b 1
".venv\Scripts\python.exe" cli.py run --limit 500 >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"

echo ======== run finished %DATE% %TIME% (exit %RC%) ======== >> "%LOG%"
exit /b %RC%
