import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SLOT_HOURS, SLOT_LABELS } from './slot-constants.mjs';

const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseTime(value) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : 0;
}

function kstDate(value) {
  const time = parseTime(value);
  if (!time) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(time));
  const mapped = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day}`;
}

function evidenceValues(signal) {
  const relatedPosts = Array.isArray(signal?.relatedPosts) ? signal.relatedPosts : [];
  return [
    signal?.publishedAt,
    signal?.evidenceAt,
    signal?.evidenceTime,
    signal?.evidenceTimestamp,
    signal?.evidence?.publishedAt,
    ...relatedPosts.flatMap((item) => [item?.publishedAt, item?.evidenceAt, item?.evidenceTime, item?.evidenceTimestamp])
  ];
}

function evidenceRecord(signal) {
  return evidenceValues(signal)
    .map((value) => ({ value, time: parseTime(value) }))
    .filter((record) => record.time)
    .sort((left, right) => right.time - left.time)[0] ?? null;
}

function validateRealtimePayload(payload, slotAdapter = null, now = null) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['payload_not_object'] };
  }

  const generatedTime = parseTime(payload.generated_at);
  if (!generatedTime || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(String(payload.generated_at ?? ''))) {
    errors.push('malformed_generated_at');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(payload.generated_date ?? ''))) {
    errors.push('malformed_generated_date');
  }
  if (generatedTime && payload.generated_date !== kstDate(payload.generated_at)) {
    errors.push('generated_date_mismatch');
  }

  if (!Number.isInteger(payload.slot_hour) || !SLOT_HOURS.includes(payload.slot_hour)) {
    errors.push('malformed_slot_hour');
  } else if (payload.cycle_label !== SLOT_LABELS[payload.slot_hour]?.cycleLabel) {
    errors.push('slot_label_mismatch');
  }

  const signals = Array.isArray(payload.signals) ? payload.signals : null;
  const items = Array.isArray(payload.items) ? payload.items : null;
  if (!signals || !items) errors.push('payload_arrays_required');
  if (!signals?.length || !items?.length) errors.push('empty_payload');
  if (signals && items && signals.length !== items.length) errors.push('signal_item_count_mismatch');

  const comparisonNow = now ? parseTime(now) : generatedTime;
  for (let index = 0; index < Math.max(signals?.length ?? 0, items?.length ?? 0); index += 1) {
    const signal = signals?.[index];
    const item = items?.[index];
    const evidence = evidenceRecord(signal);
    if (!evidence) {
      errors.push(`stale_or_unknown_evidence:${index}`);
      continue;
    }
    if (comparisonNow && (evidence.time > comparisonNow || comparisonNow - evidence.time > MAX_EVIDENCE_AGE_MS)) {
      errors.push(`stale_or_future_evidence:${index}`);
    }
    if (item && (item.name !== signal?.stockName || item.symbol !== signal?.stockCode)) {
      errors.push(`signal_item_identity_mismatch:${index}`);
    }
    const itemTime = parseTime(item?.timestamp);
    if (!itemTime || itemTime !== evidence.time) {
      errors.push(`timestamp_laundering:${index}`);
    }
  }

  if (slotAdapter !== null) {
    if (!slotAdapter || typeof slotAdapter !== 'object' || Array.isArray(slotAdapter)) {
      errors.push('slot_adapter_not_object');
    } else {
      if (slotAdapter.slotHour !== payload.slot_hour) errors.push('slot_adapter_slot_mismatch');
      if (slotAdapter.generatedAt !== payload.generated_at) errors.push('slot_adapter_generated_at_mismatch');
      if (slotAdapter.generatedDate !== payload.generated_date) errors.push('slot_adapter_generated_date_mismatch');
      if (slotAdapter.itemCount !== signals?.length) errors.push('slot_adapter_item_count_mismatch');
    }
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function parseArgs(argv) {
  const args = { realtime: path.join(REPO_ROOT, 'public/report/data/realtime-surge.json'), slot: path.join(REPO_ROOT, 'public/report/data/slot-adapter.json') };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--realtime') args.realtime = path.resolve(process.cwd(), argv[++index]);
    else if (argv[index] === '--slot') args.slot = path.resolve(process.cwd(), argv[++index]);
    else throw new Error(`unknown_argument:${argv[index]}`);
  }
  return args;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label}_read_failed:${error.code ?? 'invalid_json'}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = validateRealtimePayload(readJson(args.realtime, 'realtime_payload'), readJson(args.slot, 'slot_adapter'));
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, errors: result.errors }));
    process.exitCode = 1;
    return result;
  }
  console.log(JSON.stringify({ ok: true }));
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { MAX_EVIDENCE_AGE_MS, evidenceRecord, main, validateRealtimePayload };
