const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

test('publisher rejects stale briefing artifacts after fetching the latest remote tree', async () => {
  const { assertNotOlderBriefing } = await import('../scripts/publish-generated-report.mjs');
  const current = '<h1>2026-09-08 08:30</h1><h1>2026-09-07 16:00</h1>';
  assert.throws(() => assertNotOlderBriefing(current, '<h1>2026-09-07 16:00</h1>'), /publish_would_replace_newer_briefing/);
  assert.throws(() => assertNotOlderBriefing(current, ''), /publish_would_replace_newer_briefing/);
  assert.doesNotThrow(() => assertNotOlderBriefing(current, current));
  assert.doesNotThrow(() => assertNotOlderBriefing(current, '<h1>2026-09-08 16:00</h1>'));
});

test('backfill uses the requested date and refuses a newer published briefing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'briefing-backfill-'));
  const target = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const env = { ...process.env, REPORT_LLM_MOCK: '1', PRESERVE_EXISTING_REPORTS: '0', BRIEFING_PHASE: 'post_market', BRIEFING_AS_OF: `${target}T16:00:00+09:00` };
  const script = resolve(__dirname, '../scripts/generate-market-briefing.mjs');
  try {
    const run = spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const html = readFileSync(join(cwd, 'public/report/index.html'), 'utf8');
    assert.ok(html.includes(`<h1>${target} 16:00</h1>`));
    assert.match(html, /급락 종목/);
    mkdirSync(join(cwd, 'report'));
    writeFileSync(join(cwd, 'report/index.html'), '<h1>2099-01-01 08:30</h1>');
    const blocked = spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /backfill_would_replace_newer_briefing/);
    const invalid = spawnSync(process.execPath, [script], { cwd, env: { ...env, BRIEFING_AS_OF: 'invalid' }, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid_briefing_as_of/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
