@echo off
REM The free-tier alarm, on its own schedule.
REM
REM This used to run only at the end of collect.cmd, behind file recovery, the main collection, the digest,
REM page indexing and OCR -- forty minutes of work. On 14 Sept the collection task was killed mid-run when the
REM laptop slept, so the check never executed at all. An alarm that only fires when a long job happens to
REM finish is not an alarm; its silence is indistinguishable from "everything is fine", which is the failure
REM this project keeps rediscovering.
REM
REM The GitHub copy (storage.yml) cannot cover the gap either: it needs Actions minutes, which are exhausted
REM until the 1st of each month.
REM
REM So it runs alone, takes seconds, and needs nothing else to have succeeded. cli.py storage exits non-zero
REM once Cloudflare R2 or Neon passes 60%, which is what raises the notification.

setlocal
set "REPO=%~dp0.."
set "LOGDIR=%LOCALAPPDATA%\RegulationTracker"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\storage.log"
for %%F in ("%LOG%") do if %%~zF GTR 2000000 del "%LOG%"

echo. >> "%LOG%"
echo ======== storage check %DATE% %TIME% ======== >> "%LOG%"

cd /d "%REPO%\services\pipeline" || exit /b 1
".venv\Scripts\python.exe" cli.py storage >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo ---- PAST THE THRESHOLD - see the lines above ---- >> "%LOG%"
  powershell -NoProfile -WindowStyle Hidden -Command ^
    "Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true; $n.ShowBalloonTip(30000, 'Regulation Tracker', 'Free storage has passed 60%%. Run: cli.py storage', 'Warning'); Start-Sleep -Seconds 12; $n.Dispose()"
)
exit /b %RC%
