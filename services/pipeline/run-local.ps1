# Scheduled local collection.
#
# Runs the full pipeline from this machine rather than a GitHub runner, for two reasons: GitHub-hosted minutes
# run out around the 8th of each month (~7,200 needed against 2,000 included on a private repo), and the five
# CBIC/SEBI adapters return zero from GitHub's runners while returning their full counts from here.
#
# Registered as the Windows scheduled task "RegulationTracker" -- see docs/HANDOFF.md. Remove with:
#   Unregister-ScheduledTask -TaskName 'RegulationTracker' -Confirm:$false
#
# Collection output goes through cmd's own redirection rather than a PowerShell pipeline into Add-Content:
# Add-Content buffers the whole stream and holds the file unshared, so the log could not be read at all while a
# run was in progress -- useless precisely when a run is hanging. cmd writes as it goes and opens it shareable,
# so `Get-Content -Wait` follows a run live.
#
# Exits with the pipeline's own code, so a failed adapter leaves a non-zero "Last Run Result" in task history.

Set-Location $PSScriptRoot

$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ('run-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.log')
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

# A desktop notification is the only alert channel that works here with no account, no key and no GitHub
# minutes. The Teams webhook has never been set, Resend is unconfigured, and the failed-workflow email cannot
# fire while the Actions allowance is exhausted -- so without this, a breach of the 60% threshold would be
# recorded in a log nobody reads. Best-effort by design: never let a notification failure fail the run.
function Show-Toast([string]$title, [string]$body) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null
        $esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
        $xml = '<toast><visual><binding template="ToastGeneric"><text>' + (& $esc $title) +
               '</text><text>' + (& $esc $body) + '</text></binding></visual></toast>'
        $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $doc.LoadXml($xml)
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(
            (New-Object Windows.UI.Notifications.ToastNotification $doc))
    } catch {
        ("toast failed: " + $_.Exception.Message) | Out-File -FilePath $log -Append -Encoding utf8
    }
}

"==== collection $(Get-Date -Format s) ====" | Out-File -FilePath $log -Append -Encoding utf8
$collect = (Start-Process -FilePath $env:ComSpec `
    -ArgumentList ('/c ""{0}" cli.py run --limit 500" >> "{1}" 2>&1' -f $python, $log) `
    -Wait -PassThru -NoNewWindow).ExitCode

# Short enough that buffering does not matter, and we want the text in hand to put in the notification.
"==== storage $(Get-Date -Format s) ====" | Out-File -FilePath $log -Append -Encoding utf8
$storageOut = & $python cli.py storage 2>&1
$storage = $LASTEXITCODE
$storageOut | Out-File -FilePath $log -Append -Encoding utf8

"==== end $(Get-Date -Format s)  collection=$collect  storage=$storage ====" |
    Out-File -FilePath $log -Append -Encoding utf8

if ($storage -ne 0) {
    $lines = @($storageOut | Where-Object { $_ -match '\[(warning|critical)\]' }) -join '  '
    if (-not $lines) { $lines = 'A free tier has passed 60%. See services/pipeline/logs.' }
    Show-Toast 'Regulation Tracker: storage filling up' $lines
}
if ($collect -ne 0) {
    Show-Toast 'Regulation Tracker: collection failed' 'An adapter failed. See services/pipeline/logs.'
}

# Keep a fortnight of runs; the logs are small, but this is somebody's laptop.
Get-ChildItem $logDir -Filter 'run-*.log' | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 14 | Remove-Item -Force -ErrorAction SilentlyContinue

# Collection failing matters more than the storage warning, so it wins the exit code.
if ($collect -ne 0) { exit $collect }
exit $storage
