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
  includes(source, 'data-room-link="./realtime.html"');
  includes(source, "if (href) window.location.href = href;");
  includes(source, "eyebrow: '장시작 브리핑'");
  includes(source, "sessionLabel: '08:30'");
  includes(source, "eyebrow: '장마감 브리핑'");
  includes(source, "sessionLabel: '16:00'");
  excludes(source, 'showToast()');
  excludes(source, '.room-toast');
});

test('briefing entry pages route realtime button to a separate page', () => {
  for (const relativePath of ['index.html', 'report/index.html']) {
    const html = read(relativePath);
    includes(html, 'data-room-link="./realtime.html"');
    includes(html, "if (href) window.location.href = href;");
    assert.match(html, /<div class="eyebrow published">장시작 브리핑<\/div>/);
    assert.match(html, /<div class="eyebrow published">장마감 브리핑<\/div>/);
    assert.match(html, /<h1>\d{4}-\d{2}-\d{2} 08:30<\/h1>/);
    assert.match(html, /<h1>\d{4}-\d{2}-\d{2} 16:00<\/h1>/);
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
  includes(rootRealtime, '유료 회원 전용');
  includes(rootRealtime, 'data-room-link="./index.html"');
  includes(rootRealtime, '브리핑 페이지에서 버튼으로 열리는 별도 페이지');
});

test('operations doc describes realtime as a separate page, not a toast placeholder', () => {
  const doc = read('docs/market-briefing-automation.md');
  includes(doc, '`실시간급등` 버튼은 `realtime.html`과 `report/realtime.html` 별도 페이지로 이동한다.');
  excludes(doc, '클릭 시 `준비중 입니다` 토스트만 표시한다.');
});
