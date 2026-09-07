import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicBriefingValid, waitForPublicBriefing } from './verify-public-briefing.mjs';
import { withDeadline } from './briefing-deadline.mjs';
import { resolveSlot } from './briefing-slot.mjs';
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
export function matchingRun(runs, slot, knownIds = null) {
  return runs.filter((run) => run.display_title === slot.key && run.head_branch === 'main'
    && (!knownIds || !knownIds.has(run.id)))
    .sort((a, b) => b.id - a.id)[0] ?? null;
}
export async function recoverBriefing({ date, phase, repository, token, fetchImpl = fetch, now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), checkPublic = publicBriefingValid,
  verifyPublic = waitForPublicBriefing, timeoutMs = 23 * 60000 }) {
  const slot = resolveSlot({ tradingDate: date, phase, now: new Date(now()) });
  const deadline = now() + timeoutMs;
  const apiRoot = `https://api.github.com/repos/${repository}`;
  async function api(path, body) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('recovery_observation_timeout');
    return withDeadline(async (signal) => {
      const response = await fetchImpl(`${apiRoot}${path}`, {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal
      });
      if (now() >= deadline) throw new Error('recovery_observation_timeout');
      if (!response.ok) throw new Error(`github_http_${response.status}`);
      const payload = response.status === 204 ? null : await response.json();
      if (now() >= deadline) throw new Error('recovery_observation_timeout');
      return payload;
    }, Math.min(10000, remaining));
  }
  const listRuns = async () => (await api('/actions/workflows/publish-market-briefing.yml/runs?per_page=100')).workflow_runs || [];
  try {
    if (await withDeadline(() => checkPublic({ date, phase, fetchImpl, timeoutMs: Math.min(10000, deadline - now()) }), Math.min(10000, deadline - now()))) {
      if (now() >= deadline) throw new Error('recovery_observation_timeout');
      return { reason: 'already_public', dispatched: false };
    }
  } catch (error) {
    if (now() >= deadline) throw error;
    // A transient Pages error must not be treated as a completed publication.
  }
  const initialRuns = await listRuns();
  const knownIds = new Set(initialRuns.map((run) => run.id));
  let run = matchingRun(initialRuns.filter((candidate) => ACTIVE.has(candidate.status)), slot);
  let dispatched = false;
  if (!run) {
    resolveSlot({ tradingDate: date, phase, now: new Date(now()) });
    await api('/actions/workflows/publish-market-briefing.yml/dispatches', { ref: 'main', inputs: { phase, trading_date: date } });
    dispatched = true;
  }
  while (now() < deadline) {
    if (run?.id) run = await api(`/actions/runs/${run.id}`);
    else run = matchingRun(await listRuns(), slot, knownIds);
    if (now() >= deadline) break;
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`publish_workflow_${run.conclusion || 'unknown'}:${run.id}`);
      await verifyPublic({ date, phase, now, sleep, timeoutMs: Math.min(180000, deadline - now()), check: (options) => checkPublic({ ...options, fetchImpl }) });
      if (now() >= deadline) break;
      return { reason: 'public_publication_verified', dispatched, runId: run.id };
    }
    await sleep(Math.min(5000, Math.max(0, deadline - now())));
  }
  throw new Error('recovery_observation_timeout');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await recoverBriefing({ date: process.env.BRIEFING_TRADING_DATE, phase: process.env.BRIEFING_PHASE, repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN });
  console.log(JSON.stringify(result));
}
