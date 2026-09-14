# Runs a command while telling Windows not to sleep.
#
# The collection run needs about forty uninterrupted minutes. The scheduled task runs in the interactive
# session (LogonType Interactive), and this machine sleeps after five minutes idle, so a run that starts
# without somebody at the keyboard is suspended five minutes in and killed -- the log shows "run started"
# followed immediately by ^C, three days running. Nothing was wrong with the collection; it never got to do any.
#
# SetThreadExecutionState is a user-level call: no elevation, no power-plan change, and nothing left behind
# once this process exits, because the flag lives only as long as the thread that set it. The screen is
# deliberately not kept on -- ES_DISPLAY_REQUIRED is omitted -- so the laptop can dim and lock as usual while
# the work continues.
#
# The alternative fix is to make the task S4U ("run whether the user is logged on or not"), which survives
# sleep properly but needs an elevated shell to set. See docs/HANDOFF.md.

param([Parameter(Mandatory = $true)][string]$Command)

Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@

# Written in decimal on purpose. Windows PowerShell 5.1 reads the literal 0x80000000 as a signed Int32, which
# is -2147483648, and casting that to [uint32] throws "Value was either too large or too small" -- so the flag
# is never set and the run is still killed by sleep, with only a cast error to show for it.
$ES_CONTINUOUS       = [uint32]2147483648  # 0x80000000: keep the state until told otherwise
$ES_SYSTEM_REQUIRED  = [uint32]1           # 0x00000001: the system is in use, do not sleep

try {
    $previous = [Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
    if ($previous -eq 0) { Write-Output "warning: could not request wakefulness; the run may be cut short by sleep" }
    & cmd.exe /c $Command
    exit $LASTEXITCODE
}
finally {
    # Hand sleep back. Omitting this would leave the machine awake until the next reboot.
    [void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
}
