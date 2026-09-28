import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decideBriefingAttempt, runBriefingAttemptPolicy } from '../scripts/briefing-attempt-policy.mjs';

const slotKey = 'briefing:2026-09-29:pre_market';
const priorFailure = {
  id: 42,
  display_title: slotKey,
  head_branch: 'main',
  status: 'completed',
  conclusion: 'failure',
  created_at: '2026-09-28T23:30:00Z',
  html_url: 'https://github.com/owner/report/actions/runs/42'
};

test('automatic briefing guard suppresses only the exact slot and requested ref, excluding this run', () => {
  const decision = decideBriefingAttempt({
    automatic: true,
    runs: [
      { ...priorFailure, display_title: 'briefing:2026-09-28:pre_market' },
      { ...priorFailure, id: 43, head_branch: 'release' },
      { ...priorFailure, id: 44 },
      priorFailure
    ],
    runId: 44,
    slotKey
  });
  assert.equal(decision.shouldPublish, false);
  assert.equal(decision.reason, 'prior_terminal_failure');
  assert.equal(decision.run.id, 42);
});

test('automatic successful terminal run blocks generation while manual recovery bypasses the guard', () => {
  const completedSuccess = { ...priorFailure, conclusion: 'success', id: 45 };
  const automatic = decideBriefingAttempt({ automatic: true, runs: [completedSuccess], slotKey });
  assert.equal(automatic.shouldPublish, false);
  assert.equal(automatic.reason, 'prior_success_not_public');

  const manual = decideBriefingAttempt({ automatic: false, runs: [priorFailure], slotKey });
  assert.equal(manual.shouldPublish, true);
  assert.equal(manual.reason, 'manual_recovery');
});

test('automatic GitHub lookup fails closed on an invalid run-history payload', async () => {
  const env = {
    INPUT_AUTOMATIC: 'true',
    INPUT_PHASE: 'pre_market',
    INPUT_TRADING_DATE: '2026-09-29',
    GITHUB_TOKEN: 'test-token',
    GITHUB_REPOSITORY: 'owner/report',
    GITHUB_RUN_ID: '100'
  };
  await assert.rejects(runBriefingAttemptPolicy({
    env,
    stdout: { write: () => {} },
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  }), /briefing_attempt_runs_invalid_payload/u);
});

test('publish workflow performs the attempt guard under the lock and gates generation without dropping actions read', async () => {
  const workflow = await readFile(new URL('../.github/workflows/publish-market-briefing.yml', import.meta.url), 'utf8');
  assert.match(workflow, /concurrency:\n  group: report-publish\n  cancel-in-progress: false/u);
  assert.match(workflow, /automatic:[\s\S]*?default: false\n        type: boolean/u);
  assert.match(workflow, /actions:\s*read/u);
  assert.ok(workflow.indexOf('Check prior automatic attempt inside publication lock') < workflow.indexOf('Generate briefing'));
  assert.match(workflow, /Generate briefing\n        if: .*steps\.attempt\.outputs\.should_publish == 'true'/u);
  assert.match(workflow, /Verify actual public publication\n        if: .*steps\.attempt\.outputs\.should_publish != 'false'/u);
});
