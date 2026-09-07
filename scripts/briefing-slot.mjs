import { withDeadline } from './briefing-deadline.mjs';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function seoulParts(now = new Date()) {
  const iso = new Date(+now + 9 * 3600000).toISOString();
  return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
}
export function resolveSlot({ phase = 'pre_market', tradingDate = '', asOf = '', now = new Date(), createdAt } = {}) {
  if (!['pre_market', 'post_market'].includes(phase)) throw new Error('invalid_phase');
  const current = seoulParts(now);
  const originalDate = createdAt ? seoulParts(new Date(createdAt)).date : current.date;
  const date = tradingDate || (asOf ? asOf.slice(0, 10) : originalDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('invalid_trading_date');
  if (asOf) {
    const ms = Date.parse(asOf);
    if (phase !== 'post_market' || asOf !== `${date}T16:00:00+09:00` || !Number.isFinite(ms) || ms > +now || +now - ms > 48 * 3600000) throw new Error('invalid_backfill_cutoff');
  } else {
    if (date !== current.date || originalDate !== current.date) throw new Error('delayed_slot_date_mismatch');
    if (phase === 'pre_market' ? current.hour < 8 || current.hour >= 12 : current.hour < 16) throw new Error('outside_phase_publication_window');
  }
  return { phase, date, key: `briefing:${date}:${phase}` };
}
async function main() {
  let createdAt;
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_RUN_ID) {
    createdAt = await withDeadline(async (signal) => {
      const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }, signal });
      if (!response.ok) throw new Error(`run_metadata_http_${response.status}`);
      return (await response.json()).created_at;
    }, 10000);
    if (!createdAt) throw new Error('run_metadata_missing_created_at');
  }
  const phase = process.env.INPUT_PHASE || (process.env.SCHEDULE === '20 7 * * 1-5' ? 'post_market' : 'pre_market');
  const slot = resolveSlot({ phase, tradingDate: process.env.INPUT_TRADING_DATE, asOf: process.env.BRIEFING_AS_OF, createdAt });
  const lines = `BRIEFING_PHASE=${slot.phase}\nBRIEFING_TRADING_DATE=${slot.date}\nKRX_CHECK_DATE=${slot.date}\n`;
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, lines);
  process.stdout.write(`phase=${slot.phase}\ntrading_date=${slot.date}\nslot_key=${slot.key}\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
