const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
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
  assert.equal(realtime.signals[0].stockName, '마키나락스');
  assert.ok(realtime.signals[0].channelCount >= 2);
  assert.ok(realtime.signals.length <= 20);
  assert.ok(realtime.signals.length >= 5);
  assert.equal(realtime.signals[0].stockCode, '377480');
  assert.ok(Array.isArray(realtime.signals[0].relatedPosts));
  assert.ok(realtime.signals[0].relatedPosts.length >= 1);
  assert.equal(realtime.signals[0].relatedPosts[0].label, '관련기사1');
  assert.equal(typeof realtime.signals[0].polishedHeadline, 'string');
  assert.ok(realtime.signals[0].polishedHeadline.length > 0);
  assert.equal(typeof realtime.signals[0].polishedBody, 'string');
  assert.ok(realtime.signals[0].polishedBody.length >= 100);
  assert.ok(realtime.signals[0].polishedBody.length <= 360);
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

test('realtime merge keeps 20 visible items and only prepends 5 new unique signals', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));

  const previousSignals = Array.from({ length: 20 }, (_, index) => ({
    stockName: `기존${index + 1}`,
    stockCode: String(1000 + index)
  }));

  const newSignals = [
    { stockName: '기존1', stockCode: '1000' },
    { stockName: '신규1', stockCode: '2001' },
    { stockName: '신규2', stockCode: '2002' },
    { stockName: '기존2', stockCode: '1001' },
    { stockName: '신규3', stockCode: '2003' },
    { stockName: '신규4', stockCode: '2004' },
    { stockName: '신규5', stockCode: '2005' },
    { stockName: '신규6', stockCode: '2006' }
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

test('realtime payload blocks unmapped stock candidates before accumulation', async () => {
  process.env.REALTIME_SLOT_HOUR = '14';
  const module = await import(path.join(repoRoot, 'scripts/generate-realtime-surge.mjs'));
  const payload = module.__testBuildRealtimePayload({
    stockNewsCandidates: [
      {
        companyName: '삼성전자',
        title: '삼성전자 강세',
        summary: '반도체 수요 기대감',
        source: 'Telegram test',
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
