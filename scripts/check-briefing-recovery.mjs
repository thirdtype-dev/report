import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PHASE = normalizePhase(process.env.BRIEFING_PHASE);
const REPORT_INDEX_PATH = resolve(process.cwd(), 'report/index.html');

const PHASE_CONFIG = {
  pre_market: {
    articleClass: 'report-pre-market',
    sessionLabel: '08:30'
  },
  post_market: {
    articleClass: 'report-post-market',
    sessionLabel: '16:00'
  }
};

const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function normalizePhase(value) {
  if (value === 'post_market' || value === 'post-market' || value === 'close') return 'post_market';
  return 'pre_market';
}

function dateKey(value = new Date()) {
  return SEOUL_DATE_FORMATTER.format(value);
}

function output(result) {
  process.stdout.write(`briefing_phase=${PHASE}\n`);
  process.stdout.write(`top_article_class=${result.topArticleClass ?? ''}\n`);
  process.stdout.write(`top_article_title=${result.topArticleTitle ?? ''}\n`);
  process.stdout.write(`expected_title=${result.expectedTitle}\n`);
  process.stdout.write(`should_recover=${result.shouldRecover}\n`);
  process.stdout.write(`recovery_reason=${result.reason}\n`);
}

try {
  const html = await readFile(REPORT_INDEX_PATH, 'utf-8');
  const match = html.match(/<article class="([^"]*\breport-(?:pre|post)-market\b[^"]*)">[\s\S]*?<h1>(.*?)<\/h1>/);
  const expected = PHASE_CONFIG[PHASE];
  const expectedTitle = `${dateKey()} ${expected.sessionLabel}`;

  if (!match) {
    output({
      topArticleClass: '',
      topArticleTitle: '',
      expectedTitle,
      shouldRecover: true,
      reason: 'missing_top_article'
    });
  } else {
    const topArticleClass = match[1];
    const topArticleTitle = match[2]
      .replace(/&amp;/g, '&')
      .replace(/<[^>]+>/g, '')
      .trim();
    const isExpectedPhase = topArticleClass.includes(expected.articleClass);
    const isExpectedTitle = topArticleTitle.includes(expectedTitle);

    output({
      topArticleClass,
      topArticleTitle,
      expectedTitle,
      shouldRecover: !(isExpectedPhase && isExpectedTitle),
      reason: isExpectedPhase && isExpectedTitle ? 'current_briefing_present' : 'top_briefing_stale'
    });
  }
} catch (error) {
  output({
    topArticleClass: '',
    topArticleTitle: '',
    expectedTitle: `${dateKey()} ${PHASE_CONFIG[PHASE].sessionLabel}`,
    shouldRecover: true,
    reason: `check_failed:${error.code ?? error.name ?? 'unknown'}`
  });
}
