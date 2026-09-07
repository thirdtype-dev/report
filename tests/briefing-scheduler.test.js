import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSlot } from '../scripts/briefing-slot.mjs';
import { validateBriefingHtml } from '../scripts/check-briefing-recovery.mjs';
import { waitForPublicBriefing } from '../scripts/verify-public-briefing.mjs';
import { recoverBriefing, matchingRun } from '../scripts/recover-market-briefing.mjs';

const date = '2026-09-08';
const phase = 'post_market';
const now = new Date('2026-09-08T16:20:00+09:00');
const slot = { date, phase, key: `briefing:${date}:${phase}` };
const run = { id: 42, display_title: slot.key, head_branch: 'main', status: 'in_progress' };
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
test('slot rejects delayed days, pre-market afternoon and post-market midnight', () => {
  assert.throws(() => resolveSlot({ phase, tradingDate: '2026-09-07', now }), /date_mismatch/);
  assert.throws(() => resolveSlot({ phase: 'pre_market', now }), /outside_phase/);
  assert.throws(() => resolveSlot({ phase, now: new Date('2026-09-09T00:05:00+09:00') }), /outside_phase/);
  assert.throws(() => resolveSlot({ phase, now, createdAt: '2026-09-07T22:00:00+09:00' }), /date_mismatch/);
  assert.deepEqual(resolveSlot({ phase, now }), slot);
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
test('dispatch accepted is not recovery success; observes explicit run and public page', async () => {
  let listCount = 0; let publicChecks = 0; let dispatchedBody;
  const result = await recoverBriefing({ date, phase, now: () => +now, sleep: async () => {}, repository: 'owner/report', token: 'fake',
    checkPublic: async () => ++publicChecks > 1,
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') { dispatchedBody = JSON.parse(options.body); return response(null, 204); }
      if (url.includes('?per_page')) return response({ workflow_runs: ++listCount === 1 ? [] : [{ ...run, status: 'completed', conclusion: 'success' }] });
      throw new Error('unexpected_request');
    }
  });
  assert.deepEqual(dispatchedBody.inputs, { phase, trading_date: date });
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
