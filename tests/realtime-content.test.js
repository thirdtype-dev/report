const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('realtime generator publishes non-mock slot content from market research', () => {
  execFileSync(process.execPath, ['scripts/generate-realtime-surge.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REALTIME_SLOT_HOUR: '11'
    }
  });

  const slotAdapter = readJson('public/report/data/slot-adapter.json');
  const realtime = readJson('public/report/data/realtime-surge.json');

  assert.equal(slotAdapter.cycleLabel, 'KST_1100');
  assert.equal(slotAdapter.slotHour, 11);
  assert.equal(slotAdapter.writer.provider, 'market-research-news');
  assert.ok(Array.isArray(realtime.signals));
  assert.ok(realtime.signals.length > 0);
  assert.equal(realtime.writer.provider, 'market-research-news');
  assert.equal(realtime.cycle_label, 'KST_1100');
  assert.ok(Array.isArray(realtime.signals[0].evidencePoints));
  assert.ok(realtime.signals[0].evidencePoints.length > 0);
});
