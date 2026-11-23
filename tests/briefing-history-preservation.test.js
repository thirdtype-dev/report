const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = resolve(__dirname, '..');
const GENERATOR_PATH = resolve(ROOT, 'scripts/generate-market-briefing.mjs');
const VALIDATOR_PATH = resolve(ROOT, 'scripts/check-briefing-recovery.mjs');

function article({ phase, title, body, informationAsOf, extraAttributes = '' }) {
  const informationAttribute = informationAsOf
    ? ` data-information-as-of="${informationAsOf}"`
    : '';
  return `<article${extraAttributes} class="report ${phase}"${informationAttribute}>
  <div class="eyebrow published">시장 브리핑</div>
  <h1>${title}</h1>
  <section><h2>시장 요약</h2><p>${body}</p></section>
</article>`;
}

function page(...articles) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>.ignored::after { content: '<article class="report report-pre-market">style</article>'; }</style><script>const ignored = '<article class="report report-post-market">script</article>';</script></head><body><!-- <article class="report report-pre-market">comment</article> -->${articles.join('\n')}</body></html>`;
}

async function importValidator() {
  return import(`${pathToFileURL(VALIDATOR_PATH).href}?history-test=${Date.now()}-${Math.random()}`);
}

function runValidator({ reportPath, previousPath, requireValid = true }) {
  const env = {
    ...process.env,
    BRIEFING_PHASE: 'pre_market',
    BRIEFING_TRADING_DATE: '2026-11-20',
    REPORT_INDEX_PATH: reportPath
  };
  if (previousPath !== undefined) env.REPORT_PREVIOUS_INDEX_PATH = previousPath;
  else delete env.REPORT_PREVIOUS_INDEX_PATH;
  return spawnSync(process.execPath, [VALIDATOR_PATH, ...(requireValid ? ['--require-valid'] : [])], {
    cwd: ROOT,
    env,
    encoding: 'utf8'
  });
}

async function writeClockPreload(directory) {
  const path = join(directory, 'fixed-clock.mjs');
  await writeFile(path, `const RealDate = globalThis.Date;
const fixed = RealDate.parse('2026-11-20T17:00:00+09:00');
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixed])); }
  static now() { return fixed; }
}
globalThis.Date = FixedDate;
`, 'utf8');
  return path;
}

async function runGenerator({ preserve }) {
  const directory = await mkdtemp(join(tmpdir(), `briefing-generator-${preserve}-`));
  const committedMorning = article({
    phase: 'report-pre-market',
    title: '2026-11-20 08:30',
    informationAsOf: '2026-11-20T08:30:00+09:00',
    body: '11월 20일 개장 전 브리핑의 정확한 원문 HTML을 보존합니다.',
    extraAttributes: ' data-source="attributed-archive"'
  });
  const committedClose = article({
    phase: 'report-post-market',
    title: '2026-11-19 16:00',
    informationAsOf: '2026-11-19T16:00:00+09:00',
    body: '직전 거래일 장 마감 브리핑입니다.'
  });
  const staleOutput = article({
    phase: 'report-post-market',
    title: '2026-11-18 16:00',
    informationAsOf: '2026-11-18T16:00:00+09:00',
    body: '생성 디렉터리에 남은 오래된 브리핑이며 선택되면 안 됩니다.'
  });

  await mkdir(join(directory, 'report'), { recursive: true });
  await mkdir(join(directory, 'public', 'report'), { recursive: true });
  const snapshotPath = join(directory, 'current-briefing.html');
  await writeFile(snapshotPath, page(committedMorning, committedClose), 'utf8');
  await writeFile(join(directory, 'report', 'index.html'), page(staleOutput), 'utf8');
  await writeFile(join(directory, 'public', 'report', 'index.html'), page(staleOutput), 'utf8');
  const preload = await writeClockPreload(directory);

  const result = spawnSync(process.execPath, ['--import', preload, GENERATOR_PATH], {
    cwd: directory,
    env: {
      ...process.env,
      REPORT_LLM_MOCK: '1',
      PRESERVE_EXISTING_REPORTS: preserve,
      BRIEFING_TRADING_DATE: '2026-11-20',
      BRIEFING_AS_OF: '2026-11-20T16:00:00+09:00',
      BRIEFING_PHASE: 'post_market',
      PUBLIC_REPORT_URL: 'http://127.0.0.1:1/unavailable',
      REPORT_PREVIOUS_INDEX_PATH: snapshotPath
    },
    encoding: 'utf8'
  });

  return { directory, committedMorning, result };
}

test('validator extraction returns objects while retaining exact visible article HTML', async () => {
  const { extractArticles } = await importValidator();
  const morning = article({
    phase: 'report-pre-market',
    title: '2026-11-20 08:30',
    informationAsOf: '2026-11-20T08:30:00+09:00',
    body: '개장 전 시장의 주요 변수를 충분한 길이로 정리합니다.',
    extraAttributes: ' data-source="archive"'
  });
  const close = article({
    phase: 'report-post-market',
    title: '2026-11-19 16:00',
    informationAsOf: '2026-11-19T16:00:00+09:00',
    body: '장 마감 이후 시장 변화를 충분한 길이로 정리합니다.'
  });
  assert.deepEqual(extractArticles(page(morning, close)).map((item) => item.html), [morning, close]);
});

test('require-valid fails when the earlier distinct briefing is lost', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'briefing-validator-loss-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const morning = article({
    phase: 'report-pre-market',
    title: '2026-11-20 08:30',
    informationAsOf: '2026-11-20T08:30:00+09:00',
    body: '현재 개장 전 브리핑 자체는 정상 렌더링된 상태입니다.'
  });
  const priorClose = article({
    phase: 'report-post-market',
    title: '2026-11-19 16:00',
    informationAsOf: '2026-11-19T16:00:00+09:00',
    body: '이 브리핑이 소실되면 배포 검증이 실패해야 합니다.'
  });
  const reportPath = join(directory, 'generated.html');
  const previousPath = join(directory, 'previous.html');
  await writeFile(reportPath, page(morning), 'utf8');
  await writeFile(previousPath, page(priorClose), 'utf8');
  const result = runValidator({ reportPath, previousPath });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /^recovery_reason=previous_briefing_missing$/mu);
});

test('validator enforces configured history only for require-valid', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'briefing-validator-scenarios-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const oldMorning = article({
    phase: 'report-pre-market',
    title: '2026-11-20 08:30',
    informationAsOf: '2026-11-20T08:30:00+09:00',
    body: '같은 날짜와 단계의 교체 전 브리핑입니다.',
    extraAttributes: ' data-version="old"'
  });
  const currentMorning = article({
    phase: 'report-pre-market',
    title: '2026-11-20 08:30',
    informationAsOf: '2026-11-20T08:30:00+09:00',
    body: '현재 개장 전 브리핑은 구조와 품질 검사를 통과합니다.',
    extraAttributes: ' data-version="new"'
  });
  const priorClose = article({
    phase: 'report-post-market',
    title: '2026-11-19 16:00',
    informationAsOf: '2026-11-19T16:00:00+09:00',
    body: '보존해야 하는 직전의 서로 다른 브리핑 원문입니다.'
  });
  const alteredClose = priorClose.replace('브리핑 원문입니다.', '변경된 브리핑입니다.');

  const scenarios = [
    {
      name: 'accepts byte-identical earlier history',
      current: page(currentMorning, priorClose),
      previous: page(priorClose),
      status: 0,
      reason: 'previous_briefing_preserved'
    },
    {
      name: 'rejects altered earlier history',
      current: page(currentMorning, alteredClose),
      previous: page(priorClose),
      status: 1,
      reason: 'previous_briefing_changed'
    },
    {
      name: 'accepts empty initial history',
      current: page(currentMorning),
      previous: '<!doctype html><html><body><main>no prior briefing</main></body></html>',
      status: 0,
      reason: 'no_earlier_distinct_briefing'
    },
    {
      name: 'skips the replaced same date and phase slot',
      current: page(currentMorning, priorClose),
      previous: page(oldMorning, priorClose),
      status: 0,
      reason: 'previous_briefing_preserved'
    }
  ];

  for (const [index, scenario] of scenarios.entries()) {
    await t.test(scenario.name, async () => {
      const reportPath = join(directory, `current-${index}.html`);
      const previousPath = join(directory, `previous-${index}.html`);
      await writeFile(reportPath, scenario.current, 'utf8');
      await writeFile(previousPath, scenario.previous, 'utf8');
      const result = runValidator({ reportPath, previousPath });
      assert.equal(result.status, scenario.status, result.stderr || result.stdout);
      assert.match(result.stdout, new RegExp(`^history_validation=${scenario.reason}$`, 'mu'));
    });
  }

  await t.test('fails when the configured baseline is unreadable', async () => {
    const reportPath = join(directory, 'current-missing-baseline.html');
    await writeFile(reportPath, page(currentMorning), 'utf8');
    const result = runValidator({
      reportPath,
      previousPath: join(directory, 'missing-baseline.html')
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^recovery_reason=previous_check_failed:ENOENT$/mu);
  });

  await t.test('inspection without require-valid ignores the optional path', async () => {
    const reportPath = join(directory, 'current-inspection.html');
    await writeFile(reportPath, page(currentMorning), 'utf8');
    const result = runValidator({
      reportPath,
      previousPath: join(directory, 'missing-inspection-baseline.html'),
      requireValid: false
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^should_recover=false$/mu);
    assert.match(result.stdout, /^history_validation=not_requested$/mu);
  });
});

test('generator prefers the configured committed snapshot over stale checkout, stale output, and failed public fetch', async (t) => {
  const fixture = await runGenerator({ preserve: '1' });
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  assert.equal(fixture.result.status, 0, fixture.result.stderr || fixture.result.stdout);
  const generated = await readFile(join(fixture.directory, 'public', 'report', 'index.html'), 'utf8');
  const { extractArticles } = await importValidator();
  const articles = extractArticles(generated).map((item) => item.html);
  assert.equal(articles.length, 2);
  assert.match(articles[0], /<h1>2026-11-20 16:00<\/h1>/u);
  assert.equal(articles[1], fixture.committedMorning);
  assert.doesNotMatch(generated, /2026-11-18 16:00/u);
});

test('PRESERVE_EXISTING_REPORTS=0 emits only the generated current briefing', async (t) => {
  const fixture = await runGenerator({ preserve: '0' });
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  assert.equal(fixture.result.status, 0, fixture.result.stderr || fixture.result.stdout);
  const generated = await readFile(join(fixture.directory, 'public', 'report', 'index.html'), 'utf8');
  const { extractArticles } = await importValidator();
  const articles = extractArticles(generated).map((item) => item.html);
  assert.equal(articles.length, 1);
  assert.match(articles[0], /<h1>2026-11-20 16:00<\/h1>/u);
  assert.doesNotMatch(generated, /2026-11-20 08:30/u);
  assert.doesNotMatch(generated, /2026-11-18 16:00/u);
});
