const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function assertNoRealtimeBoilerplate(value) {
  const text = String(value ?? '');
  assert.ok(!text.includes('관련 기사 링크에서 세부 근거를 추가로 확인할 수 있습니다'));
  assert.ok(!text.includes('단기 급등 배경은 기사 본문과 추가 공시 흐름을 함께 보며 확인하는 편이 안전합니다'));
  assert.ok(!text.includes('기사 제목과 요약에서 확인됐습니다'));
  assert.ok(!text.includes('표시 문구는'));
  assert.ok(!text.includes('채널 또는 기사에서 관련 언급이 겹쳤습니다'));
  assert.ok(!text.includes('제목 기준 변동 단서는'));
  assert.ok(!text.includes('. ,'));
}

function sentenceCount(value) {
  return String(value ?? '')
    .split(/[.!?]\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

test('telegram public parser extracts normalized message fields', async () => {
  const fixture = fs.readFileSync(path.join(repoRoot, 'tests/fixtures/telegram-public/YeouidoStory2.html'), 'utf8');
  const module = await import(path.join(repoRoot, 'scripts/realtime-telegram-public.mjs'));
  const messages = module.parseTelegramPublicMessages(fixture, 'YeouidoStory2');

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    channel: 'YeouidoStory2',
    postId: '112896',
    text: '마키나락스(377480) 상한가 직행, AI 인프라 수혜 기대감 부각',
    url: 'https://t.me/YeouidoStory2/112896',
    views: 3050,
    publishedAt: '2026-05-27T01:28:00+00:00'
  });
  assert.equal(messages[1].postId, '112897');
  assert.equal(messages[1].views, 1280);
});

test('telegram stock extraction keeps company names and drops url or metric junk', async () => {
  const module = await import(path.join(repoRoot, 'scripts/realtime-telegram-public.mjs'));
  const messages = [
    {
      channel: 'YeouidoStory2',
      text: 'https://n.news.naver.com/mnews/article/422/0000868737?sid=101',
      url: 'https://t.me/YeouidoStory2/112917',
      publishedAt: '2026-05-27T01:55:57+00:00'
    },
    {
      channel: 'YeouidoStory2',
      text: '[사피엔반도체(452430,KQ) / 유진투자증권] 하반기 AR Glass 출시 경쟁 수혜',
      url: 'https://t.me/YeouidoStory2/112899',
      publishedAt: '2026-05-26T23:55:53+00:00'
    },
    {
      channel: 'bumgore',
      text: '삼성물산 제이피모건 투자의견: 비중확대(Overweight) 목표주가: ₩570,000',
      url: 'https://t.me/bumgore/54344',
      publishedAt: '2026-05-27T01:35:00+00:00'
    }
  ];

  const candidates = module.messagesToTelegramNewsCandidates(messages);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].title, '사피엔반도체 하반기 AR Glass 출시 경쟁 수혜');
  assert.equal(candidates[1].title, '삼성물산 비중확대(Overweight) 목표주가: ₩570,000');
});

test('realtime generator prefers telegram public signals when fixtures are available', () => {
  const persistedPath = path.join(repoRoot, 'report/data/realtime-surge.json');
  const originalPersisted = fs.existsSync(persistedPath) ? fs.readFileSync(persistedPath, 'utf8') : null;

  try {
    fs.writeFileSync(persistedPath, JSON.stringify({
      generated_date: '2026-05-26',
      signals: []
    }, null, 2));

    execFileSync(process.execPath, ['scripts/generate-realtime-surge.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        REALTIME_SLOT_HOUR: '11',
        REALTIME_TELEGRAM_FIXTURE_DIR: path.join(repoRoot, 'tests/fixtures/telegram-public'),
        REALTIME_POLISH_MOCK: '1'
      }
    });
  } finally {
    if (originalPersisted == null) {
      fs.unlinkSync(persistedPath);
    } else {
      fs.writeFileSync(persistedPath, originalPersisted);
    }
  }

  const slotAdapter = readJson('public/report/data/slot-adapter.json');
  const realtime = readJson('public/report/data/realtime-surge.json');

  assert.equal(slotAdapter.cycleLabel, 'KST_1100');
  assert.equal(slotAdapter.slotHour, 11);
  assert.equal(slotAdapter.writer.provider, 'telegram-public-web');
  assert.ok(Array.isArray(realtime.signals));
  assert.ok(realtime.signals.length > 0);
  assert.equal(realtime.writer.provider, 'telegram-public-web');
  assert.equal(realtime.cycle_label, 'KST_1100');
  assert.ok(Array.isArray(realtime.signals[0].evidencePoints));
  assert.ok(realtime.signals[0].evidencePoints.length > 0);
  assert.equal(realtime.summary.basedOn, 'public telegram channel mentions with market news backfill');
  assert.ok(realtime.signals.length <= 20);
  assert.ok(realtime.signals.length >= 4);
  assert.ok(realtime.signals.some((signal) => signal.hasTelegram));
  assert.ok(realtime.signals.every((signal) => Array.isArray(signal.relatedPosts)));
  assert.ok(realtime.signals.every((signal) => signal.relatedPosts.length >= 1));
  assert.ok(realtime.signals.every((signal) => signal.relatedPosts.every((item) => !String(item.source).startsWith('Telegram'))));
  assert.equal(typeof realtime.signals[0].polishedHeadline, 'string');
  assert.ok(realtime.signals[0].polishedHeadline.length > 0);
  assert.equal(typeof realtime.signals[0].polishedBody, 'string');
  assert.ok(realtime.signals[0].polishedBody.length > 0);
  assert.ok(realtime.signals[0].polishedBody.length <= 360);
  assertNoRealtimeBoilerplate(realtime.signals[0].polishedBody);
});

test('realtime polish prompt stays compact and excludes raw evidence blobs', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const prompt = module.__testBuildRealtimePolishPrompt([
    {
      stockName: 'SK하이닉스',
      stockCode: '000660',
      headline: 'SK하이닉스 가 시총 1조 달러를 돌파했다',
      summary: 'HBM 실적 개선과 목표주가 상향이 함께 부각됐다',
      relatedPosts: [
        { title: '미래에셋증권, SK하이닉스 목표주가 상향', source: '기사' },
        { title: '외국인 순매수세 유입', source: '텔레그램' }
      ],
      evidencePoints: [
        '출처 Telegram @investment_puzzle, 비즈니스포스트 기반 기사 3건',
        '제목 기준 변동률 단서 +19.0%',
        '매우 긴 원문 블롭 '.repeat(40)
      ],
      direction: 'up',
      changeRate: 19,
      channelCount: 2
    }
  ]);

  assert.ok(prompt.length < 2500);
  assert.ok(!prompt.includes('매우 긴 원문 블롭'));
  assert.ok(prompt.includes('"headline":"SK하이닉스 가 시총 1조 달러를 돌파했다"'));
});

test('realtime polish requests are chunked into stable batch sizes', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const signals = Array.from({ length: 20 }, (_, index) => ({ stockName: `종목${index + 1}` }));
  const batches = module.__testChunkSignalsForPolish(signals, 5);

  assert.equal(batches.length, 4);
  assert.deepEqual(batches.map((batch) => batch.length), [5, 5, 5, 5]);
  assert.equal(batches[0][0].stockName, '종목1');
  assert.equal(batches[3][4].stockName, '종목20');
});

test('realtime openrouter polish request matches the looser briefing request shape', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const body = module.__testBuildOpenRouterPolishRequest('prompt body');

  assert.equal(body.model, 'openrouter/free');
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 1400);
  assert.ok(!('response_format' in body));
  assert.ok(!('provider' in body));
});

test('realtime merge keeps 20 visible items and only prepends 5 new unique signals', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));

  const previousSignals = Array.from({ length: 20 }, (_, index) => ({
    stockName: `기존${index + 1}`,
    stockCode: String(1000 + index),
    source: '연합뉴스',
    sourceUrl: `https://example.com/existing-${index + 1}`,
    relatedPosts: [
      {
        label: '관련기사1',
        source: '연합뉴스',
        url: `https://example.com/existing-${index + 1}`
      }
    ]
  }));

  const newSignals = [
    { stockName: '기존1', stockCode: '1000', source: '연합뉴스', sourceUrl: 'https://example.com/existing-1', relatedPosts: [{ label: '관련기사1', source: '연합뉴스', url: 'https://example.com/existing-1' }] },
    { stockName: '신규1', stockCode: '2001', source: '매일경제', sourceUrl: 'https://example.com/new-1', relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new-1' }] },
    { stockName: '신규2', stockCode: '2002', source: '매일경제', sourceUrl: 'https://example.com/new-2', relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new-2' }] },
    { stockName: '기존2', stockCode: '1001', source: '연합뉴스', sourceUrl: 'https://example.com/existing-2', relatedPosts: [{ label: '관련기사1', source: '연합뉴스', url: 'https://example.com/existing-2' }] },
    { stockName: '신규3', stockCode: '2003', source: '매일경제', sourceUrl: 'https://example.com/new-3', relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new-3' }] },
    { stockName: '신규4', stockCode: '2004', source: '매일경제', sourceUrl: 'https://example.com/new-4', relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new-4' }] },
    { stockName: '신규5', stockCode: '2005', source: '매일경제', sourceUrl: 'https://example.com/new-5', relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new-5' }] },
    { stockName: '신규6', stockCode: '2006', source: '매일경제', sourceUrl: 'https://example.com/new-6', relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new-6' }] }
  ];

  const merged = module.__testMergeRealtimeSignals(newSignals, previousSignals, {
    freshBatchSize: 5,
    visibleLimit: 20
  });

  assert.deepEqual(
    merged.freshSignals.map((signal) => signal.stockName),
    ['신규1', '신규2', '신규3', '신규4', '신규5']
  );
  assert.equal(merged.mergedSignals.length, 20);
  assert.deepEqual(
    merged.mergedSignals.slice(0, 5).map((signal) => signal.stockName),
    ['신규1', '신규2', '신규3', '신규4', '신규5']
  );
  assert.ok(!merged.mergedSignals.some((signal, index) => index < 5 && signal.stockName.startsWith('기존')));
  assert.ok(merged.mergedSignals.some((signal) => signal.stockName === '기존3'));
});

test('fresh-only polish reuses prior polished copy for carry-over signals', async () => {
  process.env.REALTIME_SLOT_HOUR = '930';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));

  const previousSignals = [
    {
      stockName: '기존1',
      stockCode: '1000',
      headline: '기존1 헤드라인',
      summary: '기존1 요약',
      source: '연합뉴스',
      sourceUrl: 'https://example.com/existing-1',
      relatedPosts: [{ label: '관련기사1', source: '연합뉴스', url: 'https://example.com/existing-1' }],
      polishedHeadline: '기존1 기존 polish 제목',
      polishedBody: '기존1 기존 polish 본문입니다. 이전 실행에서 생성된 요약을 그대로 유지합니다.'
    },
    {
      stockName: '기존2',
      stockCode: '1001',
      headline: '기존2 헤드라인',
      summary: '기존2 요약',
      source: '연합뉴스',
      sourceUrl: 'https://example.com/existing-2',
      relatedPosts: [{ label: '관련기사1', source: '연합뉴스', url: 'https://example.com/existing-2' }],
      polishedHeadline: '기존2 기존 polish 제목',
      polishedBody: '기존2 기존 polish 본문입니다. 이전 실행에서 생성된 요약을 그대로 유지합니다.'
    }
  ];

  const newSignals = [
    {
      stockName: '신규1',
      stockCode: '2001',
      headline: '신규1 헤드라인',
      summary: '신규1 요약',
      source: '매일경제',
      sourceUrl: 'https://example.com/new-1',
      relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new-1' }]
    },
    {
      stockName: '신규2',
      stockCode: '2002',
      headline: '신규2 헤드라인',
      summary: '신규2 요약',
      source: '매일경제',
      sourceUrl: 'https://example.com/new-2',
      relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new-2' }]
    }
  ];

  const merged = module.__testMergeRealtimeSignals(newSignals, previousSignals, {
    freshBatchSize: 2,
    visibleLimit: 20
  });

  const finalSignals = module.__testAssembleFinalSignals(
    merged.mergedSignals,
    [
      { ...newSignals[0], polishedHeadline: '신규1 새 polish 제목', polishedBody: '신규1 새 polish 본문입니다. 이번 실행에서 새로 생성된 요약입니다.' },
      { ...newSignals[1], polishedHeadline: '신규2 새 polish 제목', polishedBody: '신규2 새 polish 본문입니다. 이번 실행에서 새로 생성된 요약입니다.' }
    ]
  );

  assert.equal(finalSignals[0].polishedHeadline, '신규1 새 polish 제목');
  assert.equal(finalSignals[1].polishedHeadline, '신규2 새 polish 제목');
  assert.equal(finalSignals[2].polishedHeadline, '기존1 기존 polish 제목');
  assert.equal(finalSignals[3].polishedHeadline, '기존2 기존 polish 제목');
});

test('realtime merge drops prior telegram-only signals from carry-over pool', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));

  const previousSignals = [
    {
      stockName: '텔레그램잔존',
      stockCode: '1000',
      source: 'Telegram @foo',
      sourceUrl: 'https://t.me/foo/1',
      relatedPosts: [{ label: '관련기사1', source: 'Telegram @foo', url: 'https://t.me/foo/1' }]
    },
    {
      stockName: '뉴스잔존',
      stockCode: '1001',
      source: '연합뉴스',
      sourceUrl: 'https://example.com/news-keep',
      relatedPosts: [{ label: '관련기사1', source: '연합뉴스', url: 'https://example.com/news-keep' }]
    }
  ];

  const newSignals = [
    { stockName: '신규뉴스', stockCode: '2001', source: '매일경제', sourceUrl: 'https://example.com/new', relatedPosts: [{ label: '관련기사1', source: '매일경제', url: 'https://example.com/new' }] }
  ];

  const merged = module.__testMergeRealtimeSignals(newSignals, previousSignals, {
    freshBatchSize: 5,
    visibleLimit: 20
  });

  assert.ok(!merged.mergedSignals.some((signal) => signal.stockName === '텔레그램잔존'));
  assert.ok(merged.mergedSignals.some((signal) => signal.stockName === '뉴스잔존'));
});

test('realtime generator carries prior-day signals forward to keep 20 visible items', () => {
  const persistedPath = path.join(repoRoot, 'report/data/realtime-surge.json');
  const originalPersisted = fs.existsSync(persistedPath) ? fs.readFileSync(persistedPath, 'utf8') : null;
  const previousSignals = Array.from({ length: 16 }, (_, index) => ({
    stockName: `기존보유${index + 1}`,
    stockCode: String(7000 + index),
    summary: `기존 보유 종목 ${index + 1} 요약`,
    headline: `기존 보유 종목 ${index + 1} 헤드라인`,
    relatedPosts: [
      {
        label: '관련기사1',
        title: `기존 보유 종목 ${index + 1} 기사`,
        source: '연합뉴스',
        url: `https://example.com/old-${index + 1}`
      }
    ],
    source: '연합뉴스',
    sourceUrl: `https://example.com/old-${index + 1}`
  }));

  try {
    fs.writeFileSync(persistedPath, JSON.stringify({
      generated_date: '2026-05-26',
      signals: previousSignals
    }, null, 2));

    execFileSync(process.execPath, ['scripts/generate-realtime-surge.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        REALTIME_SLOT_HOUR: '11',
        REALTIME_TELEGRAM_FIXTURE_DIR: path.join(repoRoot, 'tests/fixtures/telegram-public'),
        REALTIME_POLISH_MOCK: '1'
      }
    });
  } finally {
    if (originalPersisted == null) {
      fs.unlinkSync(persistedPath);
    } else {
      fs.writeFileSync(persistedPath, originalPersisted);
    }
  }

  const realtime = readJson('public/report/data/realtime-surge.json');
  assert.equal(realtime.signals.length, 20);
  assert.ok(realtime.signals.some((signal) => signal.stockName === '기존보유1'));
  assert.ok(realtime.signals.every((signal) => typeof signal.polishedHeadline === 'string' && signal.polishedHeadline.length > 0));
  assert.ok(realtime.signals.every((signal) => typeof signal.polishedBody === 'string' && signal.polishedBody.length > 0));
  realtime.signals.forEach((signal) => assertNoRealtimeBoilerplate(signal.polishedBody));
});

test('realtime payload hides telegram-only candidates and exposes only news links for mixed signals', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const payload = module.__testBuildRealtimePayload({
    stockNewsCandidates: [
      {
        companyName: '마키나락스',
        stockCode: '377480',
        title: '마키나락스 상한가 직행, AI 인프라 수혜 기대감 부각',
        summary: 'Telegram @YeouidoStory2 공개 채널 멘션',
        source: 'Telegram @YeouidoStory2',
        sourceUrl: 'https://t.me/YeouidoStory2/112896',
        publishedAt: '2026-05-27T01:28:00+00:00'
      },
      {
        companyName: '삼성전자',
        stockCode: '005930',
        title: '삼성전자, HBM 수요 기대에 장중 강세',
        summary: 'Telegram @investment_puzzle 공개 채널 멘션',
        source: 'Telegram @investment_puzzle',
        sourceUrl: 'https://t.me/investment_puzzle/10',
        publishedAt: '2026-05-27T01:29:00+00:00'
      },
      {
        companyName: '삼성전자',
        stockCode: '005930',
        title: '삼성전자, HBM 수요 기대에 장중 강세',
        summary: 'HBM 수요 기대와 외국인 매수세가 함께 부각됐다',
        source: '연합뉴스',
        sourceUrl: 'https://example.com/samsung-news',
        publishedAt: '2026-05-27T01:27:00+00:00'
      },
      {
        companyName: 'SK하이닉스',
        stockCode: '000660',
        title: 'SK하이닉스, 목표가 상향에 9%대 급등',
        summary: '목표주가 상향과 HBM 실적 기대가 반영됐다',
        source: '매일경제',
        sourceUrl: 'https://example.com/sk-news',
        publishedAt: '2026-05-27T01:26:00+00:00'
      }
    ]
  }, 14, '2026-05-27T05:00:00.000Z', '2026-05-27', { maxSignals: 10 });

  assert.deepEqual(payload.signals.map((signal) => signal.stockName), ['삼성전자', 'SK하이닉스']);
  assert.equal(payload.signals[0].source, '연합뉴스');
  assert.ok(payload.signals[0].relatedPosts.length >= 1);
  assert.ok(payload.signals[0].relatedPosts.every((item) => !String(item.source).startsWith('Telegram')));
  assert.ok(payload.signals.every((signal) => signal.relatedPosts.length >= 1));
});

test('google news backfill converts telegram-only company mentions into news candidates', async () => {
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const backfilled = module.__testBuildGoogleNewsBackfillCandidates(
    [
      {
        companyName: '하나마이크론',
        stockCode: '067310',
        title: '하나마이크론 HBM 관련 기대감 부각',
        summary: 'Telegram @merITz_tech 공개 채널 멘션',
        source: 'Telegram @merITz_tech',
        sourceUrl: 'https://t.me/merITz_tech/1',
        publishedAt: '2026-05-28T00:00:00Z'
      }
    ],
    [
      {
        companyName: '하나마이크론',
        title: '하나마이크론, HBM 기대감에 장중 강세',
        summary: 'HBM 후공정 수요 기대가 반영됐다',
        source: '연합뉴스',
        sourceUrl: 'https://example.com/hana-news',
        publishedAt: '2026-05-28T00:10:00Z'
      },
      {
        companyName: '무관종목',
        title: '무관종목 기사',
        summary: '무관',
        source: '연합뉴스',
        sourceUrl: 'https://example.com/other-news',
        publishedAt: '2026-05-28T00:11:00Z'
      }
    ]
  );

  assert.equal(backfilled.length, 1);
  assert.equal(backfilled[0].companyName, '하나마이크론');
  assert.equal(backfilled[0].source, '연합뉴스');
  assert.equal(backfilled[0].sourceUrl, 'https://example.com/hana-news');
});

test('display normalization removes telegram source labels when news links exist', async () => {
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const normalized = module.__testNormalizeSignalDisplaySources({
    stockName: 'SK하이닉스',
    stockCode: '000660',
    source: 'Telegram @investment_puzzle',
    sourceUrl: 'https://t.me/investment_puzzle/123',
    relatedPosts: [
      { label: '관련기사1', source: 'Telegram @investment_puzzle', url: 'https://t.me/investment_puzzle/123' },
      { label: '관련기사2', source: '연합뉴스', url: 'https://example.com/sk-news' }
    ]
  });

  assert.equal(normalized.source, '연합뉴스');
  assert.equal(normalized.sourceUrl, 'https://example.com/sk-news');
  assert.ok(normalized.relatedPosts.every((item) => !String(item.source).startsWith('Telegram')));
});

test('fallback polish rewrites noisy copied text into cleaner display copy', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const polished = module.__testBuildFallbackPolish({
    stockName: '한화시스템',
    headline: "[오늘의 주목주] '차익실현 압력' 한화시스템 주가 5%대 하락, 코스닥 디앤디파마텍 15%대 급등",
    summary: "[오늘의 주목주] '차익실현 압력' 한화시스템 주가 5%대 하락, 코스닥 디앤디파마텍 15%대 급등 비즈니스포스트",
    relatedPosts: [
      {
        title: "[오늘의 주목주] '차익실현 압력' 한화시스템 주가 5%대 하락, 코스닥 디앤디파마텍 15%대 급등",
        source: '비즈니스포스트',
        url: 'https://example.com/hanwha-news'
      }
    ],
    channelCount: 1,
    changeRate: -5
  });

  assert.notEqual(polished.polishedHeadline, "[오늘의 주목주] '차익실현 압력' 한화시스템 주가 5%대 하락, 코스닥 디앤디파마텍 15%대 급등");
  assert.ok(!polished.polishedHeadline.includes('[오늘의 주목주]'));
  assert.ok(!polished.polishedBody.includes('비즈니스포스트'));
  assert.ok(polished.polishedBody.length > 0);
  assertNoRealtimeBoilerplate(polished.polishedBody);
});

test('fallback polish does not append repeated generic boilerplate', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const polished = module.__testBuildFallbackPolish({
    stockName: 'LG화학',
    headline: "LG화학 '2차전지 주식 강세' LG화학 9%대 급등",
    summary: '2차전지 관련주 강세 흐름이 부각됐다',
    relatedPosts: [
      {
        title: "LG화학 '2차전지 주식 강세' LG화학 9%대 급등",
        source: '비즈니스포스트',
        url: 'https://example.com/lgchem-news'
      }
    ],
    source: '비즈니스포스트',
    channelCount: 1,
    direction: 'up',
    changeRate: 9
  });

  assertNoRealtimeBoilerplate(polished.polishedBody);
  assert.ok(polished.polishedBody.includes('LG화학'));
  assert.ok(polished.polishedBody.includes('LG화학은'));
  assert.ok(!polished.polishedBody.includes('LG화학는'));
  assert.ok(!polished.polishedBody.includes('은 ,'));
  assert.ok(!polished.polishedBody.includes('는 ,'));
});

test('fallback polish produces at least four detail sentences without changing the card', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const signal = {
    stockName: '티로보틱스',
    stockCode: '117730',
    headline: '[특징주] 티로보틱스, 오버행 우려에…12% 급락 - 조선비즈',
    summary: '[특징주] 티로보틱스, 오버행 우려에…12% 급락 - 조선비즈 Chosunbiz',
    evidencePoints: [
      '출처 Chosunbiz 기반 기사 1건',
      '제목 기준 변동률 단서 -12.0%',
      '[특징주] 티로보틱스, 오버행 우려에…12% 급락 - 조선비즈'
    ],
    relatedPosts: [
      {
        label: '관련기사1',
        title: '[특징주] 티로보틱스, 오버행 우려에…12% 급락 - 조선비즈',
        source: 'Chosunbiz',
        url: 'https://example.com/t-robotics'
      }
    ],
    direction: 'down',
    changeRate: -12,
    channelCount: 1,
    polishedBody: '티로보틱스는 오버행 우려에…12% 급락.'
  };

  const polished = module.__testBuildFallbackPolish(signal);

  assert.equal(signal.stockName, '티로보틱스');
  assert.equal(signal.stockCode, '117730');
  assert.ok(sentenceCount(polished.polishedBody) >= 4);
  assertNoRealtimeBoilerplate(polished.polishedBody);
});

test('fallback polish keeps four sentences even when change-rate evidence is missing', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const polished = module.__testBuildFallbackPolish({
    stockName: '삼성전자',
    stockCode: '005930',
    headline: '삼성전자 파업 우려에 코스피 7200선',
    summary: '코스피, 美 국채금리 급등·삼성전자 파업 우려에 7200선',
    relatedPosts: [
      {
        label: '관련기사1',
        title: '삼성전자 파업 우려에 코스피 7200선',
        source: '연합뉴스',
        url: 'https://example.com/samsung'
      }
    ],
    direction: 'up',
    changeRate: null
  });

  assert.ok(sentenceCount(polished.polishedBody) >= 4);
  assert.ok(polished.polishedBody.includes('005930'));
  assertNoRealtimeBoilerplate(polished.polishedBody);
});

test('description refresh preserves cards and updates only supporting copy', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const payload = {
    signals: [
      {
        stockName: '티로보틱스',
        stockCode: '117730',
        headline: '[특징주] 티로보틱스, 오버행 우려에…12% 급락 - 조선비즈',
        summary: '[특징주] 티로보틱스, 오버행 우려에…12% 급락 - 조선비즈 Chosunbiz',
        relatedPosts: [{ label: '관련기사1', title: '[특징주] 티로보틱스, 오버행 우려에…12% 급락 - 조선비즈', source: 'Chosunbiz', url: 'https://example.com/t-robotics' }],
        direction: 'down',
        changeRate: -12,
        polishedHeadline: '티로보틱스 오버행 우려에…12% 급락',
        polishedBody: '짧은 설명.'
      },
      {
        stockName: 'NAVER',
        stockCode: '035420',
        headline: 'NAVER 주가 장중 12.93% 상승',
        summary: 'NAVER 주가, 5월 29일 장중 231,500원 12.93% 상승',
        relatedPosts: [{ label: '관련기사1', title: 'NAVER 주가 장중 12.93% 상승', source: '한국경제', url: 'https://example.com/naver' }],
        direction: 'up',
        changeRate: 12.93,
        polishedHeadline: 'NAVER 주가 장중 상승',
        polishedBody: '짧은 설명.'
      }
    ],
    items: []
  };

  const refreshed = module.__testRefreshRealtimeDescriptions(payload, '2026-06-01T00:00:00.000Z');

  assert.deepEqual(refreshed.signals.map((signal) => signal.stockName), ['티로보틱스', 'NAVER']);
  assert.deepEqual(refreshed.signals.map((signal) => signal.stockCode), ['117730', '035420']);
  assert.equal(refreshed.signals[0].polishedHeadline, '티로보틱스 오버행 우려에…12% 급락');
  assert.ok(refreshed.signals.every((signal) => sentenceCount(signal.polishedBody) >= 4));
  refreshed.signals.forEach((signal) => assertNoRealtimeBoilerplate(signal.polishedBody));
});

test('assembly refreshes stale boilerplate polished body from carry-over signals', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const finalSignals = module.__testAssembleFinalSignals([
    {
      stockName: '하나기술',
      stockCode: '299030',
      headline: '하나기술 수주 계약 취소 우려 부각',
      summary: '수주 계약 취소 이슈가 투자심리에 부담으로 작용했다',
      source: '연합뉴스',
      sourceUrl: 'https://example.com/hana-tech',
      relatedPosts: [
        {
          label: '관련기사1',
          title: '하나기술 수주 계약 취소 우려 부각',
          source: '연합뉴스',
          url: 'https://example.com/hana-tech'
        }
      ],
      direction: 'down',
      polishedHeadline: '하나기술 수주 계약 취소 우려',
      polishedBody: '하나기술는 , 수주 계약 취소 우려가 부각됐습니다. 관련 기사 링크에서 세부 근거를 추가로 확인할 수 있습니다. 단기 급등 배경은 기사 본문과 추가 공시 흐름을 함께 보며 확인하는 편이 안전합니다. 표시 문구는 하나기술에 직접 연결된 제목과 요약만 기준으로 정리했습니다.'
    }
  ], []);

  assert.equal(finalSignals.length, 1);
  assertNoRealtimeBoilerplate(finalSignals[0].polishedBody);
  assert.ok(finalSignals[0].polishedBody.includes('하나기술'));
});

test('realtime payload blocks unmapped stock candidates before accumulation', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const payload = module.__testBuildRealtimePayload({
    stockNewsCandidates: [
      {
        companyName: '삼성전자',
        title: '삼성전자 강세',
        summary: '반도체 수요 기대감',
        source: '연합뉴스',
        sourceUrl: 'https://example.com/1',
        publishedAt: '2026-05-27T01:00:00+00:00'
      },
      {
        companyName: '견인',
        title: '지수 견인',
        summary: '비종목 토큰',
        source: 'Telegram test',
        sourceUrl: 'https://example.com/2',
        publishedAt: '2026-05-27T01:01:00+00:00'
      },
      {
        companyName: '미확인종목',
        title: '미확인종목 강세',
        summary: '코드 매핑 없음',
        source: 'Telegram test',
        sourceUrl: 'https://example.com/3',
        publishedAt: '2026-05-27T01:02:00+00:00'
      }
    ]
  }, 14, '2026-05-27T05:00:00.000Z', '2026-05-27', { maxSignals: 10 });

  assert.deepEqual(
    payload.signals.map((signal) => ({ name: signal.stockName, code: signal.stockCode })),
    [{ name: '삼성전자', code: '005930' }]
  );
});

test('direction inference uses target stock clause when headline mentions mixed movers', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const payload = module.__testBuildRealtimePayload({
    stockNewsCandidates: [
      {
        companyName: 'LG화학',
        title: "LG화학 '2차전지 주식 강세' LG화학 9%대 급등, 코스닥 케어젠 11%대 급락",
        summary: "LG화학은 '2차전지 주식 강세' 흐름 속 9%대 급등했고, 코스닥 케어젠은 11%대 급락했다.",
        source: '비즈니스포스트',
        sourceUrl: 'https://example.com/lgchem-mixed-movers',
        publishedAt: '2026-06-01T01:00:00+00:00'
      }
    ]
  }, 14, '2026-06-01T05:00:00.000Z', '2026-06-01', { maxSignals: 10 });

  assert.equal(payload.signals.length, 1);
  assert.equal(payload.signals[0].stockName, 'LG화학');
  assert.equal(payload.signals[0].stockCode, '051910');
  assert.equal(payload.signals[0].direction, 'up');
  assert.equal(payload.signals[0].sentimentLabel, 'positive');
  assert.equal(payload.signals[0].changeRate, 9);
});

test('carry-over signals refresh target stock direction from headline context', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const merged = module.__testMergeRealtimeSignals([], [
    {
      stockName: 'LG화학',
      stockCode: '051910',
      headline: "LG화학 '2차전지 주식 강세' LG화학 9%대 급등, 코스닥 케어젠 11%대 급락",
      sentimentLabel: 'negative',
      direction: 'down',
      changeRate: 9,
      source: '비즈니스포스트',
      sourceUrl: 'https://example.com/lgchem-mixed-movers',
      relatedPosts: [
        {
          label: '관련기사1',
          source: '비즈니스포스트',
          url: 'https://example.com/lgchem-mixed-movers'
        }
      ]
    }
  ], {
    freshBatchSize: 5,
    visibleLimit: 20
  });

  assert.equal(merged.mergedSignals.length, 1);
  assert.equal(merged.mergedSignals[0].direction, 'up');
  assert.equal(merged.mergedSignals[0].sentimentLabel, 'positive');
  assert.equal(merged.mergedSignals[0].changeRate, 9);
});

test('listed stocks master is available for realtime stock code lookup', () => {
  const listed = readJson('report/data/listed-stocks.json');
  assert.ok(listed.count > 2000);
  assert.equal(listed.lookup['삼성전자'], '005930');
  assert.equal(listed.lookup['SK스퀘어'], '402340');
});
