import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicBriefingValid, waitForPublicBriefing } from './verify-public-briefing.mjs';
import { withDeadline } from './briefing-deadline.mjs';
import { resolveSlot } from './briefing-slot.mjs';
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const DUPLICATE_SUPPRESSION_STEP = 'Suppress duplicate automatic attempt';

export function matchingRun(runs, slot, knownIds = null) {
  return runs.filter((run) => run.display_title === slot.key && run.head_branch === 'main'
    && (!knownIds || !knownIds.has(run.id)))
    .sort((a, b) => b.id - a.id)[0] ?? null;
}

function matchingFailure(runs, slot, excludedId) {
  return matchingRun(runs.filter((run) => run.id !== excludedId
    && (run.conclusion === 'failure' || run.status === 'failure')), slot);
}

function isTerminal(run) {
  return run.status === 'completed' || run.status === 'failure' || run.status === 'cancelled'
    || run.status === 'timed_out' || run.status === 'skipped' || run.conclusion != null;
}

function isSuccess(run) {
  return run.conclusion === 'success' || run.status === 'success';
}

function isTransientPublicCheckError(error) {
  const message = String(error?.message ?? '');
  return /^public_report_http_(?:408|425|429|5\d\d)$/u.test(message)
    || message === 'request_deadline_exceeded'
    || (error instanceof TypeError && /fetch failed|network|socket|timed out|timeout/iu.test(message));
}

function alreadyReportedResult(run, dispatched) {
  return {
    reason: 'publication_failed_already_reported',
    dispatched,
    verifiedPublication: false,
    runId: run.id,
    runUrl: run.html_url ?? null
  };
}

function logRecoveryResult(result, stdout = console.log) {
  if (result.reason === 'publication_failed_already_reported') {
    stdout(`publication_failed_already_reported verified-publication=false run_url=${result.runUrl ?? ''}`);
    return;
  }
  stdout(JSON.stringify(result));
}

export async function recoverBriefing({ date, phase, repository, token, fetchImpl = fetch, now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), checkPublic = publicBriefingValid,
  verifyPublic = waitForPublicBriefing, timeoutMs = 23 * 60000, scheduled = false }) {
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
  const listRuns = async () => {
    const result = await api('/actions/workflows/publish-market-briefing.yml/runs?per_page=100');
    if (!Array.isArray(result.workflow_runs)) throw new Error('github_workflow_runs_invalid_payload');
    return result.workflow_runs;
  };
  const duplicateSuppressed = async (candidate) => {
    if (!candidate.id) return false;
    const jobs = (await api(`/actions/runs/${candidate.id}/jobs?per_page=100`)).jobs || [];
    return jobs.some((job) => (job.steps || []).some((step) => step.name === DUPLICATE_SUPPRESSION_STEP && step.conclusion === 'success'));
  };
  try {
    if (await withDeadline(() => checkPublic({ date, phase, fetchImpl, timeoutMs: Math.min(10000, deadline - now()) }), Math.min(10000, deadline - now()))) {
      if (now() >= deadline) throw new Error('recovery_observation_timeout');
      return { reason: 'already_public', dispatched: false };
    }
  } catch (error) {
    if (now() >= deadline) throw error;
    if (!isTransientPublicCheckError(error)) throw error;
    // A transient Pages error is treated as unverified while run history is checked.
  }
  const initialRuns = await listRuns();
  const knownIds = new Set(initialRuns.map((run) => run.id));
  const activeRun = matchingRun(initialRuns.filter((candidate) => ACTIVE.has(candidate.status)), slot);
  const existingRun = matchingRun(initialRuns, slot);
  let run = activeRun;
  let dispatched = false;

  if (!run && existingRun && isTerminal(existingRun)) {
    if (scheduled && (existingRun.conclusion === 'failure' || existingRun.status === 'failure')) {
      return alreadyReportedResult(existingRun, false);
    }
    if (isSuccess(existingRun)) {
      if (await duplicateSuppressed(existingRun)) {
        if (scheduled) {
          const failedRun = matchingFailure(await listRuns(), slot, existingRun.id);
          if (failedRun) return alreadyReportedResult(failedRun, false);
          throw new Error(`publisher_suppressed_without_prior_failure:${existingRun.id}`);
        }
      } else {
        await verifyPublic({ date, phase, now, sleep, timeoutMs: Math.min(180000, deadline - now()), check: (options) => checkPublic({ ...options, fetchImpl }) });
        if (now() >= deadline) throw new Error('recovery_observation_timeout');
        return { reason: 'public_publication_verified', dispatched: false, verifiedPublication: true, runId: existingRun.id };
      }
    }
    if (scheduled) throw new Error(`publish_workflow_${existingRun.conclusion || 'unknown'}:${existingRun.id}`);
  }

  if (!run) {
    resolveSlot({ tradingDate: date, phase, now: new Date(now()) });
    await api('/actions/workflows/publish-market-briefing.yml/dispatches', {
      ref: 'main',
      inputs: { phase, trading_date: date, automatic: scheduled ? 'true' : 'false' }
    });
    dispatched = true;
  }
  while (now() < deadline) {
    if (run?.id) run = await api(`/actions/runs/${run.id}`);
    else run = matchingRun(await listRuns(), slot, knownIds);
    if (now() >= deadline) break;
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        if (scheduled && run.conclusion === 'failure') return alreadyReportedResult(run, dispatched);
        throw new Error(`publish_workflow_${run.conclusion || 'unknown'}:${run.id}`);
      }
      if (await duplicateSuppressed(run)) {
        if (scheduled) {
          const failedRun = matchingFailure(await listRuns(), slot, run.id);
          if (failedRun) return alreadyReportedResult(failedRun, dispatched);
          throw new Error(`publisher_suppressed_without_prior_failure:${run.id}`);
        }
        if (dispatched) throw new Error(`manual_publisher_suppressed:${run.id}`);
        resolveSlot({ tradingDate: date, phase, now: new Date(now()) });
        await api('/actions/workflows/publish-market-briefing.yml/dispatches', {
          ref: 'main',
          inputs: { phase, trading_date: date, automatic: 'false' }
        });
        dispatched = true;
        run = null;
        continue;
      }
      await verifyPublic({ date, phase, now, sleep, timeoutMs: Math.min(180000, deadline - now()), check: (options) => checkPublic({ ...options, fetchImpl }) });
      if (now() >= deadline) break;
      return { reason: 'public_publication_verified', dispatched, verifiedPublication: true, runId: run.id };
    }
    await sleep(Math.min(5000, Math.max(0, deadline - now())));
  }
  throw new Error('recovery_observation_timeout');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await recoverBriefing({ date: process.env.BRIEFING_TRADING_DATE, phase: process.env.BRIEFING_PHASE, repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, scheduled: process.env.GITHUB_EVENT_NAME === 'schedule' });
  logRecoveryResult(result);
}

export { logRecoveryResult };
