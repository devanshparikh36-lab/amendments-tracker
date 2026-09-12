# Scheduled local collection.
#
# Runs the full pipeline from this machine rather than a GitHub runner, for two reasons: GitHub-hosted minutes
# run out around the 8th of each month (~7,200 needed against 2,000 included on a private repo), and the five
# CBIC/SEBI adapters return zero from GitHub's runners while returning their full counts from here.
#
# Registered as the Windows scheduled task "RegulationTracker" -- see docs/HANDOFF.md. Remove with:
#   Unregister-ScheduledTask -TaskName 'RegulationTracker' -Confirm:$false
#
# Output goes through cmd's own redirection rather than a PowerShell pipeline into Add-Content. That matters:
# Add-Content holds the file open with no sharing, so the log cannot be read at all while the run is in
# progress -- useless precisely when a run is hanging and you want to know where. cmd opens it shareable, so
# `Get-Content -Wait` works live.
#
# Exits with the pipeline's own code, so a failed adapter leaves a non-zero "Last Run Result" in the task
# history rather than passing silently.

Set-Location $PSScriptRoot

$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ('run-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.log')
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

function Invoke-Step([string]$label, [string]$argline) {
    "==== $label  $(Get-Date -Format s) ====" | Out-File -FilePath $log -Append -Encoding utf8
    $p = Start-Process -FilePath $env:ComSpec `
        -ArgumentList ('/c ""{0}" {1}" >> "{2}" 2>&1' -f $python, $argline, $log) `
        -Wait -PassThru -NoNewWindow
    return $p.ExitCode
}

$collect = Invoke-Step 'collection' 'cli.py run --limit 500'
$storage = Invoke-Step 'storage'    'cli.py storage'

"==== end $(Get-Date -Format s)  collection=$collect  storage=$storage ====" |
    Out-File -FilePath $log -Append -Encoding utf8

# Keep a fortnight of runs; the logs are small, but this is somebody's laptop.
Get-ChildItem $logDir -Filter 'run-*.log' | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 14 | Remove-Item -Force -ErrorAction SilentlyContinue

# Collection failing matters more than the storage warning, so it wins the exit code.
if ($collect -ne 0) { exit $collect }
exit $storage
