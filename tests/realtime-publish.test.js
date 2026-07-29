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
  includes(workflow, "LLM_TIMEOUT_MS: '90000'");
  includes(workflow, 'ANALYST_PROVIDER: openrouter');
  includes(workflow, 'ANALYST_MODEL: deepseek/deepseek-v4-flash');
  includes(workflow, 'OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}');
  excludes(workflow, 'ANALYST_FALLBACK_PROVIDER:');
  excludes(workflow, 'ANALYST_FALLBACK_MODEL:');
  excludes(workflow, 'GEMINI_API_KEY:');
  excludes(workflow, 'OPENCODE_ZEN_API_KEY:');
  excludes(workflow, 'OPENROUTER_FALLBACK_API_KEY:');
});

test('realtime surge workflow dispatches from Cloud Scheduler inputs', () => {
  const workflow = read('.github/workflows/publish-realtime-surge.yml');
  includes(workflow, 'name: Publish Realtime Surge');
  includes(workflow, 'workflow_dispatch:');
  includes(workflow, 'slot_hour:');
  includes(workflow, 'description_only:');
  includes(workflow, "- '9'");
  includes(workflow, "- '930'");
  includes(workflow, "- '1430'");
  includes(workflow, "- '15'");
  includes(workflow, 'python3 scripts/fetch_kind_listed_stocks.py');
  includes(workflow, 'ANALYST_PROVIDER: openrouter');
  includes(workflow, 'ANALYST_MODEL: deepseek/deepseek-v4-flash');
  includes(workflow, 'OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}');
  excludes(workflow, 'ANALYST_FALLBACK_PROVIDER:');
  excludes(workflow, 'ANALYST_FALLBACK_MODEL:');
  excludes(workflow, 'GEMINI_API_KEY:');
  excludes(workflow, 'OPENCODE_ZEN_API_KEY:');
  includes(workflow, "REALTIME_DESCRIPTION_ONLY: ${{ inputs.description_only == 'true' && '1' || '0' }}");
  excludes(workflow, 'OPENROUTER_FALLBACK_API_KEY:');
  excludes(workflow, 'schedule:');
  includes(workflow, 'node scripts/generate-realtime-surge.mjs');
  includes(workflow, 'report/data/slot-adapter.json');
});

test('report generators use OpenRouter without an external model fallback', () => {
  const briefing = read('scripts/generate-market-briefing.mjs');
  const realtime = read('scripts/generate-realtime-surge.mjs');

  includes(briefing, "const ANALYST_PROVIDER = process.env.ANALYST_PROVIDER ?? 'openrouter';");
  includes(briefing, "const ANALYST_MODEL = process.env.ANALYST_MODEL ?? 'deepseek/deepseek-v4-flash';");
  excludes(briefing, 'ANALYST_FALLBACK_PROVIDER');
  excludes(briefing, 'GEMINI_API_KEY');
  includes(realtime, "const ANALYST_PROVIDER = process.env.ANALYST_PROVIDER ?? 'openrouter';");
  includes(realtime, "const ANALYST_MODEL = process.env.ANALYST_MODEL ?? 'deepseek/deepseek-v4-flash';");
  excludes(realtime, 'ANALYST_FALLBACK_PROVIDER');
  excludes(realtime, 'GEMINI_API_KEY');
});

test('slot constants define the supported 09:00-15:00 half-hour window', () => {
  const source = read('scripts/slot-constants.mjs');
  includes(source, "key: '09:00-15:00'");
  includes(source, "930: { cycleLabel: 'KST_0930'");
  includes(source, "1430: { cycleLabel: 'KST_1430'");
  includes(source, "15: { cycleLabel: 'KST_1500'");
});
