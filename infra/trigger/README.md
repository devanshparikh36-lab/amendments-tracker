# The 07:00 trigger

One Cloudflare Worker whose entire job is to ask GitHub to start the daily collection, because GitHub's own
cron does not start it anywhere near on time.

## Why

Measured across every scheduled run from 6 September to 12 October 2026:

| workflow | cron | nominal IST | actually fired | late by |
|---|---|---|---|---|
| collection | `30 1 * * *` | 07:00 | ~12:55 | 5.9 h |
| free-tier watch | `0 2 * * *` | 07:30 | ~13:45 | 6.2 h |
| digest mail | `30 2 * * *` | 08:00 | ~14:40 | 6.7 h |

The delay is not a runner queue — GitHub's API reports `created_at` equal to `run_started_at`, so the event
itself was delivered late. It is also growing: 4.9 h average in the first week measured, 6.8 h in the last,
about +0.4 h per week.

Only the `schedule` event behaves this way. `workflow_dispatch` is delivered immediately, which is what this
Worker raises.

## What it does not do

It does not replace the cron in `worker.yml`. That stays, as a fallback for the day this Worker does not
fire — an expired token, a Cloudflare outage, someone deleting the Worker. The fallback arrives hours late
by definition, so the collection workflow's `decide` job turns it into a no-op (about 20 seconds) whenever
this trigger already collected that day.

The practical consequence: if the token below expires, collection does not stop. It goes back to arriving in
the afternoon, which is the symptom to recognise.

## Setting it up

**1. Make a token.** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.

- Repository access: **only** `devanshparikh36-lab/amendments-tracker`
- Repository permissions: **Actions → Read and write** (nothing else; it does not need contents, issues or metadata beyond the default)
- Expiry: note the date somewhere. When it lapses, collection silently returns to the afternoon.

**2. Deploy the Worker.**

```
cd infra/trigger
npx wrangler login
npx wrangler deploy
```

**3. Give it the token.** Deploy first, then set the secret — `wrangler secret put` wants the Worker to
exist. The value is pasted into the prompt, never into a file in this repository.

```
npx wrangler secret put GITHUB_TOKEN
```

## Checking it works, without waiting until tomorrow

Run the scheduled handler locally and fire it by hand:

```
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=30+1+*+*+*"
```

A success prints `collection dispatched on attempt 1` and a collection run appears in the repository's
Actions tab within a few seconds. A failure prints the HTTP status and GitHub's own message — a 403 almost
always means the token is missing the Actions write permission, a 404 means it cannot see the repository at
all.

Once deployed, the live view is Cloudflare → Workers → `as-amended-trigger` → **Cron Events**, or:

```
npx wrangler tail
```

## Timing, honestly

The trigger fires at 01:30 UTC / 07:00 IST. Collection takes 75–154 minutes, and the mail follows within a
minute of it finishing, so the mail lands between **08:15 and 09:35 IST**, typically around 08:40.

On 2 of the 12 days measured that is after 09:00. If the mail has to be in before 09:00 every day, change
the cron in `wrangler.toml` to `15 0 * * *` (06:15 IST) and redeploy — that clears every collection duration
seen so far. The cost is that the lookup then starts before 07:00.
