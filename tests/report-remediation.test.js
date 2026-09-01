const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function validRealtimePayload(overrides = {}) {
  const generatedAt = '2026-08-26T06:00:00.000Z';
  const evidenceAt = '2026-08-25T07:00:00.000Z';
  return {
    generated_at: generatedAt,
    generated_date: '2026-08-26',
    slot_hour: 10,
    cycle_label: 'KST_1000',
    state: 'loaded',
    signals: [{ stockName: '삼성전자', stockCode: '005930', publishedAt: evidenceAt, source: '연합뉴스' }],
    items: [{ name: '삼성전자', symbol: '005930', timestamp: evidenceAt }],
    ...overrides
  };
}

function validSlotAdapter(payload = validRealtimePayload()) {
  return {
    generatedAt: payload.generated_at,
    generatedDate: payload.generated_date,
    slotHour: payload.slot_hour,
    itemCount: payload.signals.length
  };
}

test('realtime prepublish validator accepts fresh evidence and matching item timestamps', async () => {
  const { validateRealtimePayload } = await import('../scripts/validate-realtime-publish.mjs');
  const payload = validRealtimePayload();
  assert.deepEqual(validateRealtimePayload(payload, validSlotAdapter(payload)), { ok: true, errors: [] });
});

test('realtime prepublish validator rejects malformed slot, empty payload, and unknown evidence', async () => {
  const { validateRealtimePayload } = await import('../scripts/validate-realtime-publish.mjs');
  const payload = validRealtimePayload({ slot_hour: 1015, cycle_label: 'KST_1015', signals: [], items: [] });
  const result = validateRealtimePayload(payload, validSlotAdapter(payload));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('malformed_slot_hour'));
  assert.ok(result.errors.includes('empty_payload'));
  assert.ok(validateRealtimePayload(validRealtimePayload({ generated_at: 'not-a-date' })).errors.includes('malformed_generated_at'));
});

test('realtime prepublish validator rejects stale evidence and timestamp laundering', async () => {
  const { validateRealtimePayload } = await import('../scripts/validate-realtime-publish.mjs');
  const stale = validRealtimePayload({
    signals: [{ stockName: '삼성전자', stockCode: '005930', publishedAt: '2026-08-25T05:00:00.000Z' }],
    items: [{ name: '삼성전자', symbol: '005930', timestamp: '2026-08-25T05:00:00.000Z' }]
  });
  const staleResult = validateRealtimePayload(stale, validSlotAdapter(stale));
  assert.ok(staleResult.errors.includes('stale_or_future_evidence:0'));

  const laundered = validRealtimePayload({
    signals: [{ stockName: '삼성전자', stockCode: '005930', publishedAt: '2026-08-26T05:30:00.000Z' }],
    items: [{ name: '삼성전자', symbol: '005930', timestamp: '2026-08-26T06:00:00.000Z' }]
  });
  const launderedResult = validateRealtimePayload(laundered, validSlotAdapter(laundered));
  assert.ok(launderedResult.errors.includes('timestamp_laundering:0'));
});

test('realtime generator drops stale/unknown carry-over and timestamps visible items from evidence', async () => {
  process.env.REALTIME_SLOT_HOUR = '10';
  const module = await import('../scripts/generate-realtime-surge.mjs');
  const generatedAt = '2026-08-26T06:00:00.000Z';
  const makeSignal = (stockName, publishedAt, extra = {}) => ({
    stockName,
    stockCode: stockName === '삼성전자' ? '005930' : stockName === 'SK하이닉스' ? '000660' : '035420',
    headline: `${stockName} 강세`,
    source: '연합뉴스',
    sourceUrl: `https://example.com/${stockName}`,
    relatedPosts: [{ source: '연합뉴스', url: `https://example.com/${stockName}` }],
    publishedAt,
    ...extra
  });
  const merged = module.__testMergeRealtimeSignals([
    makeSignal('삼성전자', '2026-08-25T07:00:00.000Z')
  ], [
    makeSignal('SK하이닉스', '2026-08-25T07:00:00.000Z'),
    makeSignal('NAVER', '2026-08-25T05:00:00.000Z'),
    makeSignal('삼성전자', null, { updatedAt: generatedAt })
  ], { generatedAt, freshBatchSize: 5, visibleLimit: 20 });
  assert.deepEqual(merged.mergedSignals.map((signal) => signal.stockName), ['삼성전자', 'SK하이닉스']);

  const payload = module.__testBuildRealtimePayload({
    stockNewsCandidates: [{
      companyName: '삼성전자',
      stockCode: '005930',
      title: '삼성전자 강세',
      summary: '수요 기대감이 반영됐습니다.',
      source: '연합뉴스',
      sourceUrl: 'https://example.com/samsung',
      publishedAt: '2026-08-26T05:30:00.000Z'
    }]
  }, 10, generatedAt, '2026-08-26', { maxSignals: 10 });
  assert.equal(payload.items[0].timestamp, '2026-08-26T05:30:00.000Z');
  assert.notEqual(payload.items[0].timestamp, generatedAt);
});

test('briefing recovery validator requires current phase/date and substantive non-placeholder content', async () => {
  const { validateBriefingHtml } = await import('../scripts/check-briefing-recovery.mjs');
  const current = '<article class="report report-pre-market"><h1>2026-08-26 08:30</h1><h2>시장 전략</h2><p>현재 시장의 주요 변수와 대응 전략을 충분한 근거로 정리했습니다.</p></article>';
  const valid = validateBriefingHtml(current, 'pre_market', new Date('2026-08-26T00:00:00.000Z'));
  assert.equal(valid.shouldRecover, false);

  const headlineOnly = '<article class="report report-pre-market"><h1>2026-08-26 08:30</h1></article>';
  assert.equal(validateBriefingHtml(headlineOnly, 'pre_market', new Date('2026-08-26T00:00:00.000Z')).reason, 'invalid_article_structure');

  const placeholder = '<article class="report report-pre-market"><h1>2026-08-26 08:30</h1><p>오늘 데이터 부족으로 확인 필요 상태가 계속되어 발행을 중단합니다.</p></article>';
  assert.equal(validateBriefingHtml(placeholder, 'pre_market', new Date('2026-08-26T00:00:00.000Z')).reason, 'placeholder_content');
});

test('publish workflows share the collision-safe group and bounded helper', () => {
  const briefing = fs.readFileSync(path.join(repoRoot, '.github/workflows/publish-market-briefing.yml'), 'utf8');
  const realtime = fs.readFileSync(path.join(repoRoot, '.github/workflows/publish-realtime-surge.yml'), 'utf8');
  assert.match(briefing, /group: report-publish/);
  assert.match(realtime, /group: report-publish/);
  assert.match(briefing, /cancel-in-progress: false/);
  assert.match(realtime, /cancel-in-progress: false/);
  const helper = fs.readFileSync(path.join(repoRoot, 'scripts/publish-generated-report.mjs'), 'utf8');
  assert.match(helper, /MAX_ATTEMPTS = 3/);
  assert.match(helper, /HEAD:main/);
  assert.match(helper, /remote_main_sha_mismatch/);
  assert.doesNotMatch(helper, /--force/);
  assert.doesNotMatch(helper, /reset --hard/);
});

test('all official workflow actions use the locked full commit SHAs', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const expected = new Set([
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97'
  ]);
  const refs = fs.readdirSync(workflowDir)
    .filter((name) => /\.ya?ml$/u.test(name))
    .flatMap((name) => fs.readFileSync(path.join(workflowDir, name), 'utf8').match(/uses:\s*([^\s#]+)/gu) ?? [])
    .map((entry) => entry.replace(/^uses:\s*/u, ''));

  assert.ok(refs.length > 0);
  assert.deepEqual(new Set(refs), expected);
  refs.forEach((ref) => assert.match(ref, /@[0-9a-f]{40}$/u));
});
