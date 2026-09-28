import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBriefingSlotCli, resolveSlot } from '../scripts/briefing-slot.mjs';
import { validateBriefingHtml } from '../scripts/check-briefing-recovery.mjs';
import { waitForPublicBriefing } from '../scripts/verify-public-briefing.mjs';
import { recoverBriefing, matchingRun, logRecoveryResult } from '../scripts/recover-market-briefing.mjs';

const date = '2026-09-08';
const phase = 'post_market';
const now = new Date('2026-09-08T16:20:00+09:00');
const slot = { date, phase, key: `briefing:${date}:${phase}` };
const run = { id: 42, display_title: slot.key, head_branch: 'main', status: 'in_progress' };
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const capture = () => {
  let value = '';
  return { write: (chunk) => { value += chunk; }, get value() { return value; } };
};
test('slot rejects delayed days, pre-market afternoon and post-market midnight', () => {
  assert.throws(() => resolveSlot({ phase, tradingDate: '2026-09-07', now }), /date_mismatch/);
  assert.throws(() => resolveSlot({ phase: 'pre_market', now }), /outside_phase/);
  assert.throws(() => resolveSlot({ phase, now: new Date('2026-09-09T00:05:00+09:00') }), /outside_phase/);
  assert.throws(() => resolveSlot({ phase, now, createdAt: '2026-09-07T22:00:00+09:00' }), /date_mismatch/);
  assert.deepEqual(resolveSlot({ phase, now }), slot);
});
test('expired scheduled recoveries skip at the CLI boundary without publication outputs or environment writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'briefing-slot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envFile = join(directory, 'github-env');
  await writeFile(envFile, 'KEEP=1\n');
  const scenarios = [
    {
      name: 'reported post-market recovery after midnight',
      env: { GITHUB_EVENT_NAME: 'schedule', SCHEDULE: '20 7 * * 1-5' },
      now: new Date('2026-09-29T00:35:03+09:00'),
      reason: 'outside_phase_publication_window'
    },
    {
      name: 'pre-market recovery at noon',
      env: { GITHUB_EVENT_NAME: 'schedule', SCHEDULE: '50 23 * * 0-4' },
      now: new Date('2026-09-29T12:00:00+09:00'),
      reason: 'outside_phase_publication_window'
    },
    {
      name: 'queued run whose creation date is previous KST day',
      env: { GITHUB_EVENT_NAME: 'schedule', SCHEDULE: '20 7 * * 1-5', GITHUB_TOKEN: 'test', GITHUB_RUN_ID: '42', GITHUB_REPOSITORY: 'owner/report' },
      now: new Date('2026-09-29T00:35:03+09:00'),
      fetchImpl: async () => response({ created_at: '2026-09-28T07:20:00Z' }),
      reason: 'delayed_slot_date_mismatch'
    }
  ];
  for (const scenario of scenarios) {
    const stdout = capture();
    const stderr = capture();
    await runBriefingSlotCli({ ...scenario, env: { ...scenario.env, GITHUB_ENV: envFile }, stdout, stderr });
    assert.equal(stdout.value, `should_run=false\nskip_reason=${scenario.reason}\n`, scenario.name);
    assert.equal(stderr.value, `Skipping expired scheduled recovery before publication: ${scenario.reason}\n`, scenario.name);
    assert.equal(await readFile(envFile, 'utf8'), 'KEEP=1\n', scenario.name);
  }
});
test('scheduled guard reads wall time after metadata crosses noon or midnight', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'briefing-slot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envFile = join(directory, 'github-env');
  await writeFile(envFile, 'KEEP=1\n');
  const NativeDate = globalThis.Date;
  const scenarios = [
    {
      cron: '50 23 * * 0-4',
      starts: '2026-09-29T11:59:59+09:00',
      afterMetadata: '2026-09-29T12:00:00+09:00',
      createdAt: '2026-09-29T02:59:59Z',
      reason: 'outside_phase_publication_window'
    },
    {
      cron: '20 7 * * 1-5',
      starts: '2026-09-29T23:59:59+09:00',
      afterMetadata: '2026-09-30T00:00:00+09:00',
      createdAt: '2026-09-29T14:59:59Z',
      reason: 'delayed_slot_date_mismatch'
    }
  ];
  for (const scenario of scenarios) {
    let clock = new NativeDate(scenario.starts);
    class ControlledDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
    }
    const stdout = capture();
    const stderr = capture();
    try {
      globalThis.Date = ControlledDate;
      await runBriefingSlotCli({
        env: { GITHUB_EVENT_NAME: 'schedule', SCHEDULE: scenario.cron, GITHUB_TOKEN: 'test', GITHUB_RUN_ID: '42', GITHUB_REPOSITORY: 'owner/report', GITHUB_ENV: envFile },
        stdout,
        stderr,
        fetchImpl: async () => {
          clock = new NativeDate(scenario.afterMetadata);
          return response({ created_at: scenario.createdAt });
        }
      });
    } finally {
      globalThis.Date = NativeDate;
    }
    assert.equal(stdout.value, `should_run=false\nskip_reason=${scenario.reason}\n`);
    assert.equal(stderr.value, `Skipping expired scheduled recovery before publication: ${scenario.reason}\n`);
    assert.equal(await readFile(envFile, 'utf8'), 'KEEP=1\n');
  }
});
test('valid scheduled recovery slots keep phase, date, key and publication environment values', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'briefing-slot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envFile = join(directory, 'github-env');
  const scenarios = [
    { cron: '50 23 * * 0-4', phase: 'pre_market', now: new Date('2026-09-29T08:50:00+09:00') },
    { cron: '20 7 * * 1-5', phase: 'post_market', now: new Date('2026-09-29T16:20:00+09:00') }
  ];
  for (const scenario of scenarios) {
    const stdout = capture();
    await runBriefingSlotCli({
      env: { GITHUB_EVENT_NAME: 'schedule', SCHEDULE: scenario.cron, GITHUB_ENV: envFile },
      now: scenario.now,
      stdout,
      stderr: capture()
    });
    const expected = `should_run=true\nphase=${scenario.phase}\ntrading_date=2026-09-29\nslot_key=briefing:2026-09-29:${scenario.phase}\n`;
    assert.equal(stdout.value, expected);
    const publicationEnv = await readFile(envFile, 'utf8');
    assert.equal(publicationEnv, `BRIEFING_PHASE=${scenario.phase}\nBRIEFING_TRADING_DATE=2026-09-29\nKRX_CHECK_DATE=2026-09-29\n`);
    await writeFile(envFile, '');
  }
});
test('manual, unknown schedule, invalid input and metadata failures remain strict', async () => {
  const early = new Date('2026-09-29T00:35:03+09:00');
  const runCli = (env, options = {}) => runBriefingSlotCli({ env, now: early, stdout: capture(), stderr: capture(), ...options });
  await assert.rejects(runCli({ GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_PHASE: 'post_market' }), /outside_phase_publication_window/u);
  await assert.rejects(runCli({ GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_PHASE: 'after_market' }), /invalid_phase/u);
  await assert.rejects(runCli({ GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_PHASE: 'pre_market', INPUT_TRADING_DATE: '2026-02-30' }), /invalid_trading_date/u);
  await assert.rejects(runCli({ GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_PHASE: 'post_market', BRIEFING_AS_OF: '2026-09-28T16:01:00+09:00' }), /invalid_backfill_cutoff/u);
  await assert.rejects(runCli({ GITHUB_EVENT_NAME: 'schedule', SCHEDULE: '0 0 * * *', INPUT_PHASE: 'post_market' }), /outside_phase_publication_window/u);

  const metadataEnv = { GITHUB_EVENT_NAME: 'schedule', SCHEDULE: '20 7 * * 1-5', GITHUB_TOKEN: 'test', GITHUB_RUN_ID: '42', GITHUB_REPOSITORY: 'owner/report' };
  await assert.rejects(runCli(metadataEnv, { fetchImpl: async () => ({ ok: false, status: 503 }) }), /run_metadata_http_503/u);
  await assert.rejects(runCli(metadataEnv, { fetchImpl: async () => response({}) }), /run_metadata_missing_created_at/u);
});
test('recovery workflow gates calendar, holiday and publication work on should_run', async () => {
  const workflow = await readFile(new URL('../.github/workflows/recover-market-briefing.yml', import.meta.url), 'utf8');
  assert.match(workflow, /- name: Skip expired scheduled recovery\n        if: steps\.slot\.outputs\.should_run == 'false'\n/u);
  assert.match(workflow, /- name: Evaluate KRX trading day\n        id: trading_day\n        if: steps\.slot\.outputs\.should_run == 'true'\n/u);
  assert.match(workflow, /- name: Skip on KRX holiday\n        if: steps\.slot\.outputs\.should_run == 'true' && steps\.trading_day\.outputs\.is_trading_day != 'true'\n/u);
  assert.match(workflow, /- name: Recover and observe public publication\n        if: steps\.slot\.outputs\.should_run == 'true' && steps\.trading_day\.outputs\.is_trading_day == 'true'\n/u);
});
test('backfill requires valid exact cutoff and matching date', () => {
  assert.equal(resolveSlot({ phase, asOf: '2026-09-07T16:00:00+09:00', now }).date, '2026-09-07');
  assert.throws(() => resolveSlot({ phase, tradingDate: date, asOf: '2026-09-07T16:00:00+09:00', now }), /invalid_backfill/);
  assert.throws(() => resolveSlot({ phase, asOf: '2026-09-05T16:00:00+09:00', now }), /invalid_backfill/);
  assert.throws(() => resolveSlot({ phase, tradingDate: '2026-02-30', now }), /invalid_trading_date/);
});
test('public validator rejects placeholder and title suffix impersonation', () => {
  const html = (title, body) => `<article class="report report-post-market"><h1>${title}</h1><p>${body}</p></article>`;
  assert.equal(validateBriefingHtml(html(`${date} 16:00`, '시장 데이터와 주요 종목 분석을 반영한 완성된 장마감 브리핑입니다.'), phase, now).shouldRecover, false);
  assert.equal(validateBriefingHtml(html(`${date} 16:00`, '시장 데이터 확인 필요 상태이므로 발행 완료라고 볼 수 없습니다.'), phase, now).shouldRecover, true);
  assert.equal(validateBriefingHtml(html(`${date} 16:00 stale`, '시장 데이터와 주요 종목 분석을 반영한 완성된 장마감 브리핑입니다.'), phase, now).shouldRecover, true);
});
test('pre-market recovery requires the exact information cutoff while post-market remains unchanged', () => {
  const preNow = new Date('2026-09-08T08:35:00+09:00');
  const cutoff = '2026-09-08T08:30:00+09:00';
  const body = '<h1>2026-09-08 08:30</h1><h2>시장 전략</h2><p>현재 시장의 주요 변수와 대응 전략을 충분한 근거로 정리했습니다.</p>';
  const article = (metadata = '') => `<article class="report report-pre-market"${metadata}>${body}</article>`;

  const oldSameDay = validateBriefingHtml(article(), 'pre_market', preNow);
  const corrected = validateBriefingHtml(article(` data-information-as-of="${cutoff}"`), 'pre_market', preNow);
  const wrongCutoff = validateBriefingHtml(article(' data-information-as-of="2026-09-08T08:31:00+09:00"'), 'pre_market', preNow);

  assert.equal(oldSameDay.shouldRecover, true);
  assert.equal(oldSameDay.reason, 'information_as_of_mismatch');
  assert.equal(corrected.shouldRecover, false);
  assert.equal(corrected.isInformationAsOf, true);
  assert.equal(wrongCutoff.shouldRecover, true);
  assert.equal(wrongCutoff.reason, 'information_as_of_mismatch');
  assert.equal(validateBriefingHtml(
    '<article class="report report-post-market"><h1>2026-09-08 16:00</h1><p>시장 데이터와 주요 종목 분석을 충분한 근거로 정리했습니다.</p></article>',
    'post_market',
    preNow
  ).shouldRecover, false);
});
test('public polling does not accept success delivered after overall deadline', async () => {
  let clock = 0;
  await assert.rejects(waitForPublicBriefing({ date, phase, timeoutMs: 10, now: () => clock, check: async () => { clock = 11; return true; } }), /timeout/);
});
test('run matching uses explicit slot, never wall-clock inference', () => {
  assert.equal(matchingRun([{ ...run, display_title: 'briefing:auto:post_market' }, { ...run, id: 41 }], slot).id, 41);
  assert.equal(matchingRun([run], slot, new Set([42])), null);
});
test('recovery attaches existing active slot and propagates publication failure', async () => {
  const calls = [];
  await assert.rejects(recoverBriefing({ date, phase, now: () => +now, repository: 'owner/report', token: 'fake', checkPublic: async () => false,
    fetchImpl: async (url, options) => { calls.push(options.method); return response(url.includes('?per_page') ? { workflow_runs: [run] } : { ...run, status: 'completed', conclusion: 'failure' }); }
  }), /publish_workflow_failure:42/);
  assert.deepEqual(calls, ['GET', 'GET']);
});
test('scheduled recovery records an already reported terminal publisher failure without dispatching', async () => {
  const failedRun = { ...run, status: 'completed', conclusion: 'failure', html_url: 'https://github.com/owner/report/actions/runs/42' };
  const calls = [];
  const result = await recoverBriefing({ date, phase, now: () => +now, repository: 'owner/report', token: 'fake', scheduled: true, checkPublic: async () => false,
    fetchImpl: async (url, options) => { calls.push(options.method); return response(url.includes('?per_page') ? { workflow_runs: [failedRun] } : null); }
  });
  assert.deepEqual(result, {
    reason: 'publication_failed_already_reported',
    dispatched: false,
    verifiedPublication: false,
    runId: 42,
    runUrl: failedRun.html_url
  });
  assert.deepEqual(calls, ['GET']);
  let log = '';
  logRecoveryResult(result, (message) => { log = message; });
  assert.equal(log, `publication_failed_already_reported verified-publication=false run_url=${failedRun.html_url}`);
});
test('scheduled observer reports a publisher failure reached after attach or dispatch', async () => {
  for (const scenario of [
    { name: 'attached active run', initialRuns: [run], expectedDispatched: false },
    { name: 'new scheduled dispatch', initialRuns: [], expectedDispatched: true }
  ]) {
    const failedRun = { ...run, status: 'completed', conclusion: 'failure', html_url: 'https://github.com/owner/report/actions/runs/42' };
    let listCalls = 0;
    const result = await recoverBriefing({ date, phase, now: () => +now, sleep: async () => {}, repository: 'owner/report', token: 'fake', scheduled: true,
      checkPublic: async () => false,
      fetchImpl: async (url, options) => {
        if (options.method === 'POST') return response(null, 204);
        if (url.includes('?per_page')) return response({ workflow_runs: ++listCalls === 1 ? scenario.initialRuns : [failedRun] });
        return response(failedRun);
      }
    });
    assert.equal(result.reason, 'publication_failed_already_reported', scenario.name);
    assert.equal(result.dispatched, scenario.expectedDispatched, scenario.name);
    assert.equal(result.verifiedPublication, false, scenario.name);
    assert.equal(result.runUrl, failedRun.html_url, scenario.name);
  }
});
test('scheduled recovery maps a suppressed success back to the original failed run', async () => {
  const failedRun = { ...run, id: 42, status: 'completed', conclusion: 'failure', html_url: 'https://github.com/owner/report/actions/runs/42' };
  const suppressedRun = { ...run, id: 43, status: 'completed', conclusion: 'success', html_url: 'https://github.com/owner/report/actions/runs/43' };
  const calls = [];
  const result = await recoverBriefing({ date, phase, now: () => +now, repository: 'owner/report', token: 'fake', scheduled: true, checkPublic: async () => false,
    fetchImpl: async (url, options) => {
      calls.push(`${options.method} ${url}`);
      if (url.includes('/jobs?')) return response({ jobs: [{ steps: [{ name: 'Suppress duplicate automatic attempt', conclusion: 'success' }] }] });
      return response({ workflow_runs: [suppressedRun, failedRun] });
    }
  });
  assert.equal(result.reason, 'publication_failed_already_reported');
  assert.equal(result.verifiedPublication, false);
  assert.equal(result.runUrl, failedRun.html_url);
  assert.equal(calls.filter((call) => call.startsWith('POST ')).length, 0);
  assert.equal(calls.some((call) => call.includes('/runs/43/jobs?')), true);
});
test('manual recovery explicitly retries a suppressed duplicate with automatic false', async () => {
  const failedRun = { ...run, id: 42, status: 'completed', conclusion: 'failure' };
  const suppressedRun = { ...run, id: 43, status: 'completed', conclusion: 'success' };
  const manualRun = { ...run, id: 44, status: 'queued' };
  let listCount = 0;
  let dispatchInputs;
  const result = await recoverBriefing({ date, phase, now: () => +now, sleep: async () => {}, repository: 'owner/report', token: 'fake', checkPublic: async () => false,
    verifyPublic: async () => true,
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') { dispatchInputs = JSON.parse(options.body).inputs; return response(null, 204); }
      if (url.includes('/jobs?')) return response({ jobs: [{ steps: [{ name: 'Suppress duplicate automatic attempt', conclusion: url.includes('/runs/43/') ? 'success' : 'skipped' }] }] });
      if (url.includes('?per_page')) return response({ workflow_runs: ++listCount === 1 ? [suppressedRun, failedRun] : [manualRun, suppressedRun, failedRun] });
      if (url.endsWith('/44')) return response({ ...manualRun, status: 'completed', conclusion: 'success' });
      throw new Error(`unexpected_request:${url}`);
    }
  });
  assert.deepEqual(dispatchInputs, { phase, trading_date: date, automatic: 'false' });
  assert.equal(result.reason, 'public_publication_verified');
  assert.equal(result.verifiedPublication, true);
});
test('scheduled terminal success without publication never dispatches and keeps the failure strict', async () => {
  const successRun = { ...run, status: 'completed', conclusion: 'success' };
  let dispatches = 0;
  await assert.rejects(recoverBriefing({ date, phase, now: () => +now, repository: 'owner/report', token: 'fake', scheduled: true, checkPublic: async () => false,
    verifyPublic: async () => { throw new Error('public_publication_timeout'); },
    fetchImpl: async (url, options) => { if (options.method === 'POST') dispatches += 1; return response(url.includes('/jobs?') ? { jobs: [] } : { workflow_runs: [successRun] }); }
  }), /public_publication_timeout/u);
  assert.equal(dispatches, 0);
});
test('dispatch accepted is not recovery success; scheduled dispatch passes automatic true and observes publication', async () => {
  let listCount = 0; let publicChecks = 0; let dispatchedBody;
  const result = await recoverBriefing({ date, phase, now: () => +now, sleep: async () => {}, repository: 'owner/report', token: 'fake',
    scheduled: true,
    checkPublic: async () => ++publicChecks > 1,
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') { dispatchedBody = JSON.parse(options.body); return response(null, 204); }
      if (url.includes('/jobs?')) return response({ jobs: [] });
      if (url.includes('?per_page')) return response({ workflow_runs: ++listCount === 1 ? [] : [{ ...run, status: 'completed', conclusion: 'success' }] });
      throw new Error('unexpected_request');
    }
  });
  assert.deepEqual(dispatchedBody.inputs, { phase, trading_date: date, automatic: 'true' });
  assert.equal(result.reason, 'public_publication_verified');
  assert.equal(publicChecks, 2);
});
test('recovery rejects a late terminal success response', async () => {
  let clock = +now;
  await assert.rejects(recoverBriefing({ date, phase, now: () => clock, timeoutMs: 10, repository: 'owner/report', token: 'fake', checkPublic: async () => false,
    fetchImpl: async (url) => { if (url.includes('?per_page')) return response({ workflow_runs: [run] }); clock += 11; return response({ ...run, status: 'completed', conclusion: 'success' }); }
  }), /recovery_observation_timeout/);
});
test('successful writer with missing public page cannot mark recovery successful', async () => {
  let clock = +now;
  await assert.rejects(recoverBriefing({ date, phase, now: () => clock, timeoutMs: 30, sleep: async (ms) => { clock += ms; }, repository: 'owner/report', token: 'fake', checkPublic: async () => false,
    fetchImpl: async (url) => response(url.includes('?per_page') ? { workflow_runs: [run] } : { ...run, status: 'completed', conclusion: 'success' })
  }), /public_publication_timeout/);
});
test('only visible articles count; script, style and comment templates cannot impersonate publication', () => {
  const fake = `<article class="report report-post-market"><h1>${date} 16:00</h1><p>시장 데이터와 주요 종목 분석을 반영한 완성된 장마감 브리핑입니다.</p></article>`;
  for (const html of [`<script>const template = '${fake}';</script>`, `<style>/* ${fake} */</style>`, `<!-- ${fake} -->`]) {
    assert.equal(validateBriefingHtml(html, phase, now).reason, 'missing_top_article');
  }
});
test('numeric-encoded placeholders and nonbreaking spaces fail quality validation', () => {
  for (const placeholder of ['&#54869;&#51064;&nbsp;&#54596;&#50836;', '&#xD655;&#xC778; &#xD544;&#xC694;']) {
    const html = `<article class="report report-post-market"><h1>${date} 16:00</h1><p>시장 데이터와 주요 종목 분석은 ${placeholder} 상태로 발행할 수 없습니다.</p></article>`;
    assert.equal(validateBriefingHtml(html, phase, now).reason, 'placeholder_content');
  }
});
test('hung public check is bounded even if cancellation is ignored', async () => {
  await assert.rejects(waitForPublicBriefing({ date, phase, timeoutMs: 15, intervalMs: 1, check: () => new Promise(() => {}) }), /public_publication_timeout/);
});
test('hung response body is bounded by the same public request deadline', async () => {
  const { publicBriefingValid } = await import('../scripts/verify-public-briefing.mjs');
  await assert.rejects(publicBriefingValid({ date, phase, timeoutMs: 15, fetchImpl: async () => ({ ok: true, text: () => new Promise(() => {}) }) }), /request_deadline_exceeded/);
});
test('hung workflow metadata body cannot exceed recovery budget', async () => {
  await assert.rejects(recoverBriefing({ date, phase, now: () => +now, timeoutMs: 15, repository: 'owner/report', token: 'fake', checkPublic: async () => false,
    fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) })
  }), /request_deadline_exceeded/);
});
test('failed or malformed run-history lookup never authorizes another dispatch', async () => {
  for (const lookupResult of [
    response(null, 503),
    response({ not_workflow_runs: [] })
  ]) {
    let dispatches = 0;
    await assert.rejects(recoverBriefing({ date, phase, now: () => +now, repository: 'owner/report', token: 'fake', checkPublic: async () => false,
      fetchImpl: async (url, options) => {
        if (options.method === 'POST') dispatches += 1;
        return lookupResult;
      }
    }));
    assert.equal(dispatches, 0);
  }
});
test('unknown public-check errors remain strict', async () => {
  let requests = 0;
  await assert.rejects(recoverBriefing({ date, phase, now: () => +now, repository: 'owner/report', token: 'fake',
    checkPublic: async () => { throw new Error('public_authentication_rejected'); },
    fetchImpl: async () => { requests += 1; return response({ workflow_runs: [] }); }
  }), /public_authentication_rejected/u);
  assert.equal(requests, 0);
});
