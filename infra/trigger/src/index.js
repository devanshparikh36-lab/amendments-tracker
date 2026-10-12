/* Starts the daily collection by asking GitHub to run the workflow, rather than waiting for GitHub to
 * remember to.
 *
 * The whole Worker is one POST. Everything else here is about the two ways that POST can fail: a network
 * blip, which is worth retrying, and a rejected token, which is not.
 *
 * Why this exists at all is in wrangler.toml. The short version: GitHub's `schedule` event was arriving
 * five to seven hours late, every day, getting worse; `workflow_dispatch` is delivered immediately.
 */

const REPO = "devanshparikh36-lab/amendments-tracker";
const WORKFLOW = "worker.yml";
const REF = "main";

/* Three tries over about seven seconds. Generous enough to ride out a transient failure, short enough that
 * it cannot collide with anything -- and the stakes are low either way, because the workflow still carries
 * its own (late) cron as a fallback for a day this never lands. */
const ATTEMPTS = 3;
const BACKOFF_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function dispatch(env) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    // Said plainly, because the symptom otherwise is a silent 401 once a day and collection quietly
    // falling back to the late cron -- which looks exactly like nothing being wrong.
    throw new Error("GITHUB_TOKEN is not set -- run: wrangler secret put GITHUB_TOKEN");
  }

  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  const init = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub rejects API requests without one. Workers does not set a useful default, and the failure
      // it produces does not mention the header.
      "User-Agent": "as-amended-trigger",
      "Content-Type": "application/json",
    },
    // The same inputs the workflow would default to. Stated rather than left blank so that a change to the
    // workflow's defaults cannot quietly change what the daily run does.
    body: JSON.stringify({ ref: REF, inputs: { command: "run", limit: "500" } }),
  };

  let lastError = "no attempt was made";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(BACKOFF_MS * 2 ** (attempt - 2));

    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastError = `network: ${err}`;
      continue;
    }

    // 204 and nothing else means accepted. GitHub returns no body on success.
    if (res.status === 204) {
      console.log(`collection dispatched on attempt ${attempt}`);
      return;
    }

    const detail = (await res.text()).slice(0, 300);
    lastError = `HTTP ${res.status} ${detail}`;

    /* A 4xx will say the same thing next time: the token expired, lost its Actions permission, or the
     * workflow was renamed. Retrying those turns one clear failure into three and delays the error by
     * seven seconds. 429 is the exception -- that one is explicitly asking us to wait. */
    if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
  }

  /* Throwing is the point. A cron invocation that throws is recorded as an error on the Worker, which is
   * what makes a failed trigger visible in Cloudflare's Cron Events view instead of being a day where
   * nothing happened and nothing said so. */
  throw new Error(`could not start collection -- ${lastError}`);
}

export default {
  async scheduled(event, env) {
    await dispatch(env);
  },
};
