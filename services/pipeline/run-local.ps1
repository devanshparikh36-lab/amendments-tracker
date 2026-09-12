# Scheduled local collection.
#
# Runs the full pipeline from this machine rather than a GitHub runner, for two reasons: GitHub-hosted minutes
# run out around the 8th of each month (~7,200 needed against 2,000 included on a private repo), and the five
# CBIC/SEBI adapters return zero from GitHub's runners while returning their full counts from here.
#
# Registered as a Windows scheduled task -- see docs/HANDOFF.md. Remove with:
#   Unregister-ScheduledTask -TaskName 'RegulationTracker' -Confirm:$false
#
# Exits with the pipeline's own code, so a failed adapter leaves a non-zero exit in the task history
# (Task Scheduler shows it as the "Last Run Result") rather than passing silently.

Set-Location $PSScriptRoot

$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ('run-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')

"==== start $(Get-Date -Format s) ====" | Add-Content -Path $log -Encoding utf8

& (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') cli.py run --limit 500 *>&1 |
    Add-Content -Path $log -Encoding utf8
$rc = $LASTEXITCODE

# Usage against the free tiers, so the numbers land in the log even when nothing is wrong.
& (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') cli.py storage *>&1 |
    Add-Content -Path $log -Encoding utf8
$storageRc = $LASTEXITCODE

"==== end $(Get-Date -Format s)  collection=$rc  storage=$storageRc ====" | Add-Content -Path $log -Encoding utf8

# Keep a fortnight of logs; they are small, but this is somebody's laptop.
Get-ChildItem $logDir -Filter 'run-*.log' | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 14 | Remove-Item -Force -ErrorAction SilentlyContinue

if ($rc -ne 0) { exit $rc }
exit $storageRc
