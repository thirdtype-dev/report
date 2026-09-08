import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBriefingTradingDay } from '../scripts/briefing-trading-day.mjs';

const now = Date.parse('2026-09-08T00:00:00Z');
const base = { ok: true, schemaVersion: 1, date: '2026-09-08', isTradingDay: true, reason: 'business_day', calendarRefreshedAt: '2026-09-01T00:00:00Z', windowStart: '2026-08-01', windowEnd: '2026-11-30' };
const options = (body = base) => ({ now, fetcher: async () => ({ ok: true, json: async () => body }) });
test('uses shared public decision with exact requested date and no credentials', async () => {
  const result = await checkBriefingTradingDay(base.date, { now, fetcher: async (url, init) => {
    assert.equal(url.href, 'https://api.thirdtype.net/v1/market/trading-day?date=2026-09-08');
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, 'error');
    return { ok: true, json: async () => base };
  } });
  assert.equal(result.isTradingDay, true);
});
test('temporary closure reported by authority stops publication', async () => {
  const result = await checkBriefingTradingDay(base.date, options({ ...base, isTradingDay: false, reason: 'synced_holiday' }));
  assert.equal(result.isTradingDay, false);
});
test('rejects malformed, mismatched, stale and contradictory authority results', async () => {
  for (const patch of [
    { ok: false }, { schemaVersion: 2 }, { date: '2026-09-09' },
    { isTradingDay: 'true' }, { reason: 'unexpected\ninjected=true' },
    { isTradingDay: false }, { reason: 'annual_holiday' },
    { calendarRefreshedAt: 'bad' }, { calendarRefreshedAt: '2026-07-01T00:00:00Z' },
    { calendarRefreshedAt: '2026-09-09T00:00:00Z' },
    { windowStart: '2026-09-09' }, { windowEnd: '2026-09-07' }, { windowEnd: '2026-11-31' }
  ]) await assert.rejects(checkBriefingTradingDay(base.date, options({ ...base, ...patch })), /invalid_calendar_response/);
  await assert.rejects(checkBriefingTradingDay(base.date, options(null)), /invalid_calendar_response/);
});
test('rejects invalid input before network access', async () => {
  for (const date of [undefined, '2026-02-30', '2026-13-01', '2026-09-08\nx=y'])
    await assert.rejects(checkBriefingTradingDay(date, { fetcher: () => assert.fail('network must not run') }), /invalid_trading_date/);
});
test('unavailable calendar never falls back to a local trading day', async () => {
  await assert.rejects(checkBriefingTradingDay(base.date, { now, fetcher: async () => ({ ok: false, status: 503 }) }), /calendar_http_503/);
  await assert.rejects(checkBriefingTradingDay(base.date, { now, fetcher: async () => { throw new Error('offline'); } }), /offline/);
});
test('bounds hanging headers and response body even when fetch ignores abort', async () => {
  for (const fetcher of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })])
    await assert.rejects(checkBriefingTradingDay(base.date, { now, fetcher, timeoutMs: 15 }), /request_deadline_exceeded/);
});
