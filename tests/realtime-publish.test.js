const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function includes(text, needle) {
  assert.ok(text.includes(needle), `expected to find ${needle}`);
}

function excludes(text, needle) {
  assert.ok(!text.includes(needle), `expected not to find ${needle}`);
}

test('market briefing workflow is dispatch-only for external scheduler control', () => {
  const workflow = read('.github/workflows/publish-market-briefing.yml');
  includes(workflow, 'workflow_dispatch:');
  excludes(workflow, 'schedule:');
  includes(workflow, "LLM_TIMEOUT_MS: '45000'");
});

test('realtime surge workflow dispatches from Cloud Scheduler inputs', () => {
  const workflow = read('.github/workflows/publish-realtime-surge.yml');
  includes(workflow, 'name: Publish Realtime Surge');
  includes(workflow, 'workflow_dispatch:');
  includes(workflow, 'slot_hour:');
  includes(workflow, 'ANALYST_PROVIDER: openrouter');
  includes(workflow, 'OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}');
  includes(workflow, 'GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}');
  excludes(workflow, 'schedule:');
  includes(workflow, 'node scripts/generate-realtime-surge.mjs');
  includes(workflow, 'report/data/slot-adapter.json');
});

test('slot constants define the supported 10:00-15:00 window', () => {
  const source = read('scripts/slot-constants.mjs');
  includes(source, "key: '10:00-15:00'");
  includes(source, "15: { cycleLabel: 'KST_1500'");
});
