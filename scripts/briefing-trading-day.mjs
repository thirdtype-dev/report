import { withDeadline } from './briefing-deadline.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENDPOINT = 'https://api.thirdtype.net/v1/market/trading-day';
const MAX_AGE_MS = 35 * 86400000;
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export async function checkBriefingTradingDay(date, { fetcher = fetch, now = Date.now(), timeoutMs = 20000 } = {}) {
  if (!validDate(date)) throw new Error('invalid_trading_date');
  const url = new URL(ENDPOINT);
  url.searchParams.set('date', date);
  const result = await withDeadline(async (signal) => {
    const response = await fetcher(url, { signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`calendar_http_${response.status}`);
    return response.json();
  }, timeoutMs);
  const refreshed = Date.parse(result?.calendarRefreshedAt);
  if (result?.ok !== true || result.schemaVersion !== 1 || result.date !== date ||
      typeof result.isTradingDay !== 'boolean' ||
      !['business_day', 'weekend', 'manual_holiday', 'year_end_closure', 'annual_holiday', 'synced_holiday'].includes(result.reason) ||
      (result.isTradingDay !== (result.reason === 'business_day')) ||
      !Number.isFinite(refreshed) || refreshed > now + 300000 || now - refreshed > MAX_AGE_MS ||
      !validDate(result.windowStart) || !validDate(result.windowEnd) ||
      result.windowStart > date || result.windowEnd < date) {
    throw new Error('invalid_calendar_response');
  }
  return result;
}

async function main() {
  const result = await checkBriefingTradingDay(process.env.KRX_CHECK_DATE);
  process.stdout.write(`is_trading_day=${result.isTradingDay}\ntrading_date=${result.date}\nskip_reason=${result.reason}\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
