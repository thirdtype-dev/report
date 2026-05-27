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
  execFileSync(process.execPath, ['scripts/generate-realtime-surge.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REALTIME_SLOT_HOUR: '11',
      REALTIME_TELEGRAM_FIXTURE_DIR: path.join(repoRoot, 'tests/fixtures/telegram-public'),
      REALTIME_POLISH_MOCK: '1'
    }
  });

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
  assert.ok(realtime.signals.length <= 5);
  assert.ok(realtime.signals.length >= 5);
  assert.equal(realtime.signals[0].stockCode, '377480');
  assert.ok(Array.isArray(realtime.signals[0].relatedPosts));
  assert.ok(realtime.signals[0].relatedPosts.length >= 1);
  assert.equal(realtime.signals[0].relatedPosts[0].label, '관련기사1');
  assert.equal(typeof realtime.signals[0].polishedHeadline, 'string');
  assert.ok(realtime.signals[0].polishedHeadline.length > 0);
  assert.equal(typeof realtime.signals[0].polishedBody, 'string');
  assert.ok(realtime.signals[0].polishedBody.length >= 120);
  assert.ok(realtime.signals[0].polishedBody.length <= 360);
});
