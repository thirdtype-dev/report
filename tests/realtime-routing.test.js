const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function includes(html, needle) {
  assert.ok(html.includes(needle), `expected to find ${needle}`);
}

function excludes(html, needle) {
  assert.ok(!html.includes(needle), `expected not to find ${needle}`);
}

test('generator renders separate-page realtime navigation', () => {
  const source = read('scripts/generate-market-briefing.mjs');
  includes(source, "const ADSENSE_CLIENT = 'ca-pub-3518959293552717'");
  includes(source, 'google-adsense-account');
  includes(source, 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}');
  includes(source, 'data-room-link="./realtime.html"');
  includes(source, "if (href) window.location.href = href;");
  excludes(source, "window.prompt('리딩방 비밀번호를 입력하세요')");
  includes(source, "eyebrow: '장시작 브리핑'");
  includes(source, "sessionLabel: '08:30'");
  includes(source, "eyebrow: '장마감 브리핑'");
  includes(source, "sessionLabel: '16:00'");
  excludes(source, 'SPONSORED BANNER');
  excludes(source, 'showToast()');
  excludes(source, '.room-toast');
});

test('briefing entry pages route realtime button to a separate page', () => {
  for (const relativePath of ['index.html', 'report/index.html']) {
    const html = read(relativePath);
    includes(html, 'google-adsense-account');
    includes(html, 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3518959293552717');
    includes(html, 'data-room-link="./realtime.html"');
    includes(html, "if (href) window.location.href = href;");
    excludes(html, "window.prompt('리딩방 비밀번호를 입력하세요')");
    excludes(html, "sessionStorage.getItem('reading-room-auth')");
    assert.match(html, /<div class="eyebrow published">장시작 브리핑<\/div>/);
    assert.match(html, /<div class="eyebrow published">장마감 브리핑<\/div>/);
    assert.match(html, /<h1>\d{4}-\d{2}-\d{2} 08:30<\/h1>/);
    assert.match(html, /<h1>\d{4}-\d{2}-\d{2} 16:00<\/h1>/);
    excludes(html, 'SPONSORED BANNER');
    excludes(html, '광고 배너 1');
    excludes(html, '광고 배너 2');
    excludes(html, 'showToast()');
    excludes(html, '.room-toast');
    excludes(html, 'id="room-toast"');
    excludes(html, '준비중 입니다');
    excludes(html, '장시작 <span class="issue-time">08:30</span>');
    excludes(html, '장마감 <span class="issue-time">16:00</span>');
    excludes(html, '장시작 브리핑</h1>');
    excludes(html, '장마감 브리핑</h1>');
  }
});

test('realtime shell pages exist, are member-only, and route back to briefing', () => {
  const rootRealtime = read('realtime.html');
  const reportRealtime = read('report/realtime.html');

  assert.equal(rootRealtime, reportRealtime, 'root/report realtime shells must stay identical');
  includes(rootRealtime, 'data-room-link="./index.html"');
  includes(rootRealtime, '<div class="eyebrow published">실시간 급등</div>');
  includes(rootRealtime, 'id="realtime-title"');
  includes(rootRealtime, 'function formatRealtimeTitle(slot)');
  includes(rootRealtime, "const dataBaseCandidates = window.location.pathname.includes('/report/')");
  includes(rootRealtime, "? ['./report/data', './data']");
  includes(rootRealtime, "async function resolveDataBase()");
  includes(rootRealtime, "const dataBase = await resolveDataBase();");
  includes(rootRealtime, 'function buildRelatedLinks(signal)');
  includes(rootRealtime, "signals.slice(0, 20).map(renderSignalCard).join('')");
  includes(rootRealtime, "const polishedHeadline = String(signal.polishedHeadline");
  includes(rootRealtime, "const polishedBody = String(signal.polishedBody || '').trim();");
  includes(rootRealtime, "label: '긍정'");
  includes(rootRealtime, "label: '우려'");
  includes(rootRealtime, "return `${date} ${slotLabel} 기준`;");
  includes(rootRealtime, 'fetch(`${dataBase}/slot-adapter.json`');
  includes(rootRealtime, 'fetch(`${dataBase}/realtime-surge.json`');
  excludes(rootRealtime, "const READING_ROOM_PASSWORD = '1710'");
  excludes(rootRealtime, "sessionStorage.getItem('reading-room-auth')");
  excludes(rootRealtime, "window.prompt('리딩방 비밀번호를 입력하세요')");
  includes(rootRealtime, 'loadRealtimeSurge();');
  includes(rootRealtime, '관련기사1');
  excludes(rootRealtime, 'signal-pill');
  excludes(rootRealtime, 'signal-time');
  excludes(rootRealtime, '유료 회원 전용');
  excludes(rootRealtime, '브리핑 / 실시간 급등');
  excludes(rootRealtime, '상태 shell');
  excludes(rootRealtime, '슬롯별 급등 후보');
  excludes(rootRealtime, '브리핑 페이지에서 버튼으로 열리는 별도 페이지');
});

test('operations doc describes realtime as a separate page, not a toast placeholder', () => {
  const doc = read('docs/market-briefing-automation.md');
  includes(doc, '`실시간급등` 버튼은 `realtime.html`과 `report/realtime.html` 별도 페이지로 이동한다.');
  excludes(doc, '클릭 시 `준비중 입니다` 토스트만 표시한다.');
});

test('ads.txt exposes the publisher id for site review', () => {
  const ads = read('ads.txt').trim();
  assert.equal(ads, 'google.com, pub-3518959293552717, DIRECT, f08c47fec0942fa0');
});
