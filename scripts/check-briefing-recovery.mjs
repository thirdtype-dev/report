import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

const PLACEHOLDER_PATTERNS = [
  /확인\s*필요/iu,
  /데이터\s*(?:부족|없음|미확인)/iu,
  /수집\s*(?:실패|불가)/iu,
  /생성\s*(?:실패|중단)/iu,
  /불러오지\s*못/iu,
  /\b(?:placeholder|n\/a)\b/iu
];

function normalizePhase(value) {
  if (value === 'post_market' || value === 'post-market' || value === 'close') return 'post_market';
  return 'pre_market';
}

function dateKey(value = new Date()) {
  return SEOUL_DATE_FORMATTER.format(value);
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/gu, "'");
}

function stripTags(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]*>/gu, ' ')).replace(/\s+/gu, ' ').trim();
}

function extractArticles(html) {
  return [...String(html ?? '').matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/giu)].map((match) => {
    const openingTag = match[1] ?? '';
    const className = openingTag.match(/\bclass\s*=\s*["']([^"']*)["']/iu)?.[1] ?? '';
    return {
      html: match[0],
      className,
      body: match[2] ?? ''
    };
  }).filter((article) => /\breport-(?:pre|post)-market\b/iu.test(article.className));
}

function inspectArticle(article) {
  if (!article) return { ok: false, reason: 'missing_top_article' };
  const titleMatch = article.body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu);
  const topArticleTitle = stripTags(titleMatch?.[1] ?? '');
  const visibleBody = stripTags(article.body.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/iu, ''));
  const hasStructuredContent = /<(?:h2|h3|p|ul|ol|table|section|div)\b/iu.test(article.body);
  const hasEnoughBody = visibleBody.length >= 20;
  const placeholder = PLACEHOLDER_PATTERNS.find((pattern) => pattern.test(visibleBody));

  if (!topArticleTitle || !hasStructuredContent || !hasEnoughBody) {
    return {
      ok: false,
      reason: 'invalid_article_structure',
      topArticleTitle,
      placeholder: false
    };
  }
  if (placeholder) {
    return {
      ok: false,
      reason: 'placeholder_content',
      topArticleTitle,
      placeholder: true
    };
  }
  return { ok: true, reason: 'article_quality_ok', topArticleTitle, placeholder: false };
}

function validateBriefingHtml(html, phase = normalizePhase(process.env.BRIEFING_PHASE), now = new Date()) {
  const normalizedPhase = normalizePhase(phase);
  const expected = PHASE_CONFIG[normalizedPhase];
  const expectedTitle = `${dateKey(now)} ${expected.sessionLabel}`;
  const topArticle = extractArticles(html)[0] ?? null;
  const quality = inspectArticle(topArticle);
  const topArticleClass = topArticle?.className ?? '';
  const topArticleTitle = quality.topArticleTitle ?? '';
  const isExpectedPhase = topArticleClass.includes(expected.articleClass);
  const isExpectedTitle = topArticleTitle.includes(expectedTitle);

  let reason = quality.reason;
  if (reason === 'article_quality_ok') {
    reason = isExpectedPhase && isExpectedTitle ? 'current_briefing_present' : 'top_briefing_stale';
  }
  return {
    topArticleClass,
    topArticleTitle,
    expectedTitle,
    shouldRecover: reason !== 'current_briefing_present',
    reason,
    articleQuality: quality.reason,
    isExpectedPhase,
    isExpectedTitle
  };
}

function output(phase, result) {
  process.stdout.write(`briefing_phase=${phase}\n`);
  process.stdout.write(`top_article_class=${result.topArticleClass ?? ''}\n`);
  process.stdout.write(`top_article_title=${result.topArticleTitle ?? ''}\n`);
  process.stdout.write(`expected_title=${result.expectedTitle}\n`);
  process.stdout.write(`should_recover=${result.shouldRecover}\n`);
  process.stdout.write(`recovery_reason=${result.reason}\n`);
  process.stdout.write(`article_quality=${result.articleQuality ?? ''}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const phase = normalizePhase(process.env.BRIEFING_PHASE);
  const requireValid = argv.includes('--require-valid');
  const reportPath = resolve(process.env.REPORT_INDEX_PATH ?? 'report/index.html');
  let result;
  try {
    const html = await readFile(reportPath, 'utf-8');
    result = validateBriefingHtml(html, phase);
  } catch (error) {
    result = {
      topArticleClass: '',
      topArticleTitle: '',
      expectedTitle: `${dateKey()} ${PHASE_CONFIG[phase].sessionLabel}`,
      shouldRecover: true,
      reason: `check_failed:${error.code ?? error.name ?? 'unknown'}`,
      articleQuality: 'unavailable'
    };
  }
  output(phase, result);
  if (requireValid && result.shouldRecover) process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}

export { extractArticles, inspectArticle, main, validateBriefingHtml };
