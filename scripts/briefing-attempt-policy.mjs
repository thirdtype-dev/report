import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withDeadline } from './briefing-deadline.mjs';

const TERMINAL_STATUSES = new Set(['completed', 'success', 'failure', 'cancelled', 'timed_out', 'skipped']);

function normalizedRef(value) {
  return String(value ?? '').replace(/^refs\/heads\//u, '');
}

function isTerminalRun(run) {
  const status = String(run.status ?? '').toLowerCase();
  return TERMINAL_STATUSES.has(status) || run.conclusion != null;
}

function createdAtMs(run) {
  const timestamp = Date.parse(run.created_at ?? '');
  return Number.isFinite(timestamp) ? timestamp : Number(run.id) || 0;
}

export function decideBriefingAttempt({ automatic = false, shouldRecover = true, runs = [], runId, slotKey, ref = 'main' }) {
  if (!shouldRecover) return { shouldPublish: true, reason: 'committed_slot_current', run: null };
  if (!automatic) return { shouldPublish: true, reason: 'manual_recovery', run: null };

  const currentRunId = runId == null ? null : String(runId);
  const priorRuns = runs
    .filter((run) => run.display_title === slotKey && normalizedRef(run.head_branch) === normalizedRef(ref))
    .filter((run) => currentRunId === null || String(run.id ?? '') !== currentRunId)
    .filter(isTerminalRun)
    .sort((left, right) => createdAtMs(right) - createdAtMs(left));
  const priorRun = priorRuns[0] ?? null;
  if (!priorRun) return { shouldPublish: true, reason: 'automatic_first_attempt', run: null };

  const successful = String(priorRun.conclusion ?? priorRun.status ?? '').toLowerCase() === 'success';
  return {
    shouldPublish: false,
    reason: successful ? 'prior_success_not_public' : 'prior_terminal_failure',
    run: priorRun
  };
}

function safeRunUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.toString() : '';
  } catch {
    return '';
  }
}

export async function runBriefingAttemptPolicy({
  env = process.env,
  fetchImpl = fetch,
  stdout = process.stdout
} = {}) {
  const automatic = String(env.INPUT_AUTOMATIC ?? '').toLowerCase() === 'true';
  const shouldRecover = String(env.INPUT_SHOULD_RECOVER ?? 'true').toLowerCase() === 'true';
  const slotKey = `briefing:${env.INPUT_TRADING_DATE}:${env.INPUT_PHASE}`;

  let runs = [];
  if (automatic && shouldRecover) {
    const token = env.GITHUB_TOKEN?.trim();
    const repository = env.GITHUB_REPOSITORY?.trim();
    if (!token || !repository || !env.GITHUB_RUN_ID) throw new Error('briefing_attempt_policy_missing_github_context');
    const url = `https://api.github.com/repos/${repository}/actions/workflows/publish-market-briefing.yml/runs?per_page=100`;
    runs = await withDeadline(async (signal) => {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal
      });
      if (!response.ok) throw new Error(`briefing_attempt_runs_http_${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.workflow_runs)) throw new Error('briefing_attempt_runs_invalid_payload');
      return payload.workflow_runs;
    }, 10000);
  }

  const decision = decideBriefingAttempt({
    automatic,
    shouldRecover,
    runs,
    runId: env.GITHUB_RUN_ID,
    slotKey,
    ref: 'main'
  });
  const runUrl = safeRunUrl(decision.run?.html_url);
  const lines = [
    ['should_publish', String(decision.shouldPublish)],
    ['attempt_reason', decision.reason],
    ['attempt_run_id', decision.run?.id ?? ''],
    ['attempt_run_url', runUrl]
  ];
  for (const [name, value] of lines) {
    const safeValue = String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    stdout.write(`${name}=${safeValue}\n`);
  }
  return { ...decision, runUrl };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runBriefingAttemptPolicy();
}
