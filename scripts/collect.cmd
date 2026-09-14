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

REM Recover missing files first, ahead of the general queue.
REM
REM The queue is strictly oldest-first, which is right for routine work and wrong here: the attachments that
REM hold an anti-bot page instead of a document sat behind 300 tagging and self-check jobs, and a ten-minute
REM pass reached none of them. A document whose file is a block page is worse than one not yet tagged -- it
REM looks complete and reads as nothing -- so it goes first. Each fetch is browser-driven through Akamai at
REM roughly thirteen seconds, hence a modest count rather than a large one.
".venv\Scripts\python.exe" cli.py work --type fetch_document --limit 120 >> "%LOG%" 2>&1
echo ---- file recovery pass done ---- >> "%LOG%"

".venv\Scripts\python.exe" cli.py run --limit 500 >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo ---- collection exit %RC% ---- >> "%LOG%"

REM The digest goes out straight after collection rather than on its own timer: it reports what this run
REM found, so sending it at a fixed hour the machine may have slept through would mail an empty page. It
REM exits non-zero until RESEND_API_KEY and DIGEST_TO are set, which is deliberate -- a digest that silently
REM mails nobody is the failure this project keeps having.
".venv\Scripts\python.exe" cli.py digest >> "%LOG%" 2>&1
set "RCD=%ERRORLEVEL%"
echo ---- digest exit %RCD% ---- >> "%LOG%"

REM Write per-page text for newly stored PDFs, so the in-PDF search and jump-to-page cover them. Bounded per
REM run and resumable: an attachment is picked up only while it has no page index, and the key is written
REM last, so a dropped connection costs the file in flight and nothing else.
".venv\Scripts\python.exe" cli.py pageindex --limit 400 >> "%LOG%" 2>&1
echo ---- page index pass done ---- >> "%LOG%"

REM Read any newly arrived scanned PDF -- one with no text layer. The original 284-document backlog is done
REM (440 read, 15,285 pages), so in the normal case this finds nothing and exits in about six seconds: the
REM budget below is a ceiling for a day that brings a pile of scans, not a cost paid every run. The dedicated
REM hourly OCR task that cleared the backlog has been removed; it had nothing left to do.
REM
REM Time-bounded rather than count-bounded because page counts are wildly uneven -- some SEBI master circulars
REM run past 800 pages -- so a count limit would make one run instant and the next very long. Resumable: every
REM attachment attempted is marked, so stopping costs at most the file in flight.
".venv\Scripts\python.exe" cli.py ocr --minutes 20 >> "%LOG%" 2>&1
echo ---- ocr pass done ---- >> "%LOG%"

REM The free-tier check. storage.yml does this on GitHub and emails on a breach, but it cannot run while the
REM Actions allowance is exhausted -- which is most of the month. Running it here too means the 60%% warning
REM still reaches somebody in the meantime, via a desktop notification rather than mail.
".venv\Scripts\python.exe" cli.py storage >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ---- STORAGE PAST 60%% - see the lines above ---- >> "%LOG%"
  powershell -NoProfile -WindowStyle Hidden -Command ^
    "Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true; $n.ShowBalloonTip(30000, 'Regulation Tracker', 'Free storage has passed 60%%. Run: cli.py storage', 'Warning'); Start-Sleep -Seconds 12; $n.Dispose()"
)

REM Collection failing matters more than the digest failing, so it wins the exit code the scheduler shows.
if not "%RC%"=="0" set "RCD=%RC%"

echo ======== run finished %DATE% %TIME% (collection %RC%, digest %RCD%) ======== >> "%LOG%"
exit /b %RCD%
