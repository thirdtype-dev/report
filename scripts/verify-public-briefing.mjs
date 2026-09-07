import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withDeadline } from './briefing-deadline.mjs';
import { validateBriefingHtml } from './check-briefing-recovery.mjs';
export const PUBLIC_REPORT_URL = 'https://thirdtype-dev.github.io/report/report/';
export async function publicBriefingValid({ date, phase, fetchImpl = fetch, timeoutMs = 10000 }) {
  const url = new URL(PUBLIC_REPORT_URL);
  url.searchParams.set('briefing_check', `${date}-${phase}-${Date.now()}`);
  return withDeadline(async (signal) => {
    const response = await fetchImpl(url, { signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw new Error(`public_report_http_${response.status}`);
    return !validateBriefingHtml(await response.text(), phase, new Date(`${date}T00:00:00+09:00`)).shouldRecover;
  }, timeoutMs);
}
export async function waitForPublicBriefing({ date, phase, timeoutMs = 180000, intervalMs = 5000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), check = publicBriefingValid }) {
  const deadline = now() + timeoutMs;
  let lastError = 'public_briefing_not_ready';
  while (now() < deadline) {
    try {
      const remaining = Math.min(10000, deadline - now());
      const valid = await withDeadline(() => check({ date, phase, timeoutMs: remaining }), remaining);
      if (now() >= deadline) break;
      if (valid) return true;
    } catch (error) { lastError = error.message; }
    if (now() < deadline) await sleep(Math.min(intervalMs, deadline - now()));
  }
  throw new Error(`public_publication_timeout:${lastError}`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await waitForPublicBriefing({ date: process.env.BRIEFING_TRADING_DATE, phase: process.env.BRIEFING_PHASE });
  console.log('Verified target briefing on public Pages URL.');
}
