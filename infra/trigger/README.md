# The 07:00 trigger

Collection is started by an external scheduler calling GitHub's `workflow_dispatch` API. GitHub's own cron
cannot do it: measured across every scheduled run from 6 Sept to 12 Oct 2026, the `schedule` event arrived
4.8 to 7.2 hours late, and the lag grew from ~4.9h to ~6.8h over those five weeks. Only `schedule` is
affected; `workflow_dispatch` and `workflow_run` are delivered at once.

## What runs it

**cron-job.org**, 07:00 daily, timezone Asia/Kolkata.

```
URL      https://api.github.com/repos/devanshparikh36-lab/amendments-tracker/actions/workflows/worker.yml/dispatches
Method   POST
Headers  Authorization: Bearer <fine-grained PAT, Actions: Read and write, this repo only>
         Accept: application/vnd.github+json
         X-GitHub-Api-Version: 2022-11-28
         Content-Type: application/json
         User-Agent: as-amended-trigger
Body     {"ref":"main","inputs":{"command":"run","limit":"500"}}
Success  HTTP 204
```

Turn on cron-job.org's own failure notifications. They are a second channel, independent of everything here.

## Why not Cloudflare

`src/index.js` and `wrangler.toml` are a Cloudflare Worker that does the same thing. It was built first,
because the R2 bucket is already on that account and it meant no new party holding a token. It was deployed
on 13 Oct 2026 and **never ran**.

The configuration was correct and Cloudflare confirmed it: the dashboard listed both cron triggers with
correct next-run times, and the Worker had an active deployment at 100% traffic. Its metrics for the day
read 0 invocations, 0 errors, 0 CPU time. Four test slots passed without it being invoked once. Three of the
four had an explanation -- a Worker ten minutes old, a cron deployed after its own slot had passed, a slot
superseded by a later deploy -- but one had a clean fifteen-minute margin and still produced nothing.

No fault was ever found, because nothing was misconfigured. Past "zero invocations" there is nothing
observable from outside.

The files are kept rather than deleted: the code is correct as far as anyone can tell, and if Cloudflare's
scheduler starts working this is a ready alternative that keeps the token on an account already in use.

**The Worker must not be left deployed while cron-job.org is live.** If Cloudflare ever does start firing,
both would dispatch and collection would run twice a day for no reason. Delete the Worker in the dashboard
(Settings -> Danger zone), which also deletes the copy of the token held in its secrets.

## If the mail starts arriving in the afternoon again

That is the symptom of the trigger not firing. Collection does not stop -- `worker.yml` keeps its own cron
as a fallback, and the `trigger-missing` job fails on purpose when the fallback has had to do the work, so
GitHub emails about it. The run log names the likely causes.

In order of likelihood:

1. **The token expired.** Fine-grained tokens have a mandatory expiry. Check
   https://github.com/settings/personal-access-tokens, make a new one with Actions: Read and write scoped to
   this repository alone, and paste it into the cron-job.org job's Authorization header.
2. **cron-job.org disabled the job.** It deactivates jobs that fail repeatedly, and emails first.
3. **The account lapsed.** Free accounts can require re-verification.

## Testing the token by hand

Never put the token in the command text -- type it at a prompt, so it is not in shell history or anything
that can be pasted somewhere by accident. TLS 1.2 has to be forced; Windows PowerShell 5.1 still negotiates
1.0 by default and GitHub refuses, with a connection error that looks nothing like an auth problem.

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$token = Read-Host "Paste the token"
$h = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28"; "User-Agent" = "as-amended-trigger" }
$body = @{ ref = "main"; inputs = @{ command = "run"; limit = "500" } } | ConvertTo-Json -Depth 5
try { "OK - status $((Invoke-WebRequest -Method Post -Uri 'https://api.github.com/repos/devanshparikh36-lab/amendments-tracker/actions/workflows/worker.yml/dispatches' -Headers $h -Body $body).StatusCode)" }
catch { "FAILED - HTTP $($_.Exception.Response.StatusCode.value__) - $($_.Exception.Message)" }
Remove-Variable token, h
```

`204` means it worked and a collection has started. `403` is a token without Actions write, `404` one that
cannot see the repository, `401` one that is wrong or revoked. Ctrl+V does not paste into `Read-Host` in the
PowerShell console -- right-click does.

## The token is more dangerous than it looks

`Actions: write` allows dispatching **any** workflow in the repository with **any** inputs, and `worker.yml`
exposes `command: prune`, which deletes stored documents from the database and their files from R2. GitHub
cannot scope a token to "dispatch, but only these inputs".

So: one token, in one place, with an expiry date that is written down. Do not reuse it, and revoke the old
one whenever a new one is issued.

## Timing

The trigger fires at 07:00 IST. Collection takes 75-154 minutes and the mail follows within a minute of it
finishing, so the mail lands between **08:15 and 09:35 IST**, typically around 08:40. On 2 of the 12 days
measured that is after 09:00. For "before 09:00" every day, move the job to 06:15 IST -- at the cost of the
lookup starting before 07:00.
