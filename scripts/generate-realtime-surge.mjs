import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOT_HOURS, SLOT_LABELS, SLOT_SCHEDULE } from './slot-constants.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourceRealtimePath = path.join(repoRoot, 'report', 'data', 'realtime-surge.json');
const publicDataDir = path.join(repoRoot, 'public', 'report', 'data');
const outputSlotAdapterPath = path.join(publicDataDir, 'slot-adapter.json');
const outputRealtimePath = path.join(publicDataDir, 'realtime-surge.json');

const REPORT_TIMEZONE = 'Asia/Seoul';

function getKstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function formatKstHuman(date) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function resolveSlotHour() {
  const raw = process.env.REALTIME_SLOT_HOUR;
  const fallbackHour = Number.parseInt(getKstParts().hour, 10);
  const parsed = Number.parseInt(String(raw ?? fallbackHour), 10);
  if (!SLOT_HOURS.includes(parsed)) {
    throw new Error(`Unsupported realtime slot hour: ${raw ?? fallbackHour}`);
  }
  return parsed;
}

async function main() {
  const slotHour = resolveSlotHour();
  const slotLabel = SLOT_LABELS[slotHour];
  const now = new Date();
  const kst = getKstParts(now);
  const schedule = SLOT_SCHEDULE[0];
  const sourceRealtime = JSON.parse(await fs.readFile(sourceRealtimePath, 'utf8'));

  const generatedAt = now.toISOString();
  const generatedDate = `${kst.year}-${kst.month}-${kst.day}`;

  const slotAdapter = {
    schema: 'urn:hermes:slot-adapter:v1',
    scheduleKey: schedule.key,
    cycleLabel: slotLabel.cycleLabel,
    slot: slotLabel.label,
    state: 'market-open',
    slotHour,
    title: `KST ${slotLabel.label} 슬롯`,
    subtitle: `${slotLabel.label} 기준 실시간 급등 상세 데이터`,
    generatedAt,
    generatedDate,
    kstGeneratedAt: formatKstHuman(now),
    reportRef: './realtime-surge.json',
    itemCount: Array.isArray(sourceRealtime.items) ? sourceRealtime.items.length : 0,
    writer: {
      provider: 'mock',
      model: 'mock'
    }
  };

  const realtimePayload = {
    ...sourceRealtime,
    generated_at: generatedAt,
    slot_hour: slotHour,
    cycle_label: slotLabel.cycleLabel,
    slot_label: slotLabel.label,
    generated_date: generatedDate
  };

  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(outputSlotAdapterPath, `${JSON.stringify(slotAdapter, null, 2)}\n`);
  await fs.writeFile(outputRealtimePath, `${JSON.stringify(realtimePayload, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    slotHour,
    cycleLabel: slotLabel.cycleLabel,
    generatedAt
  }));
}

await main();
