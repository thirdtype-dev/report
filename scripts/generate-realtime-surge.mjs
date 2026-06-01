import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOT_HOURS, SLOT_LABELS, SLOT_SCHEDULE } from './slot-constants.mjs';
import { fetchTelegramPublicMessages, messagesToTelegramNewsCandidates } from './realtime-telegram-public.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourceMarketResearchPath = path.join(repoRoot, 'report', 'data', 'market-research.json');
const sourceRealtimePath = path.join(repoRoot, 'report', 'data', 'realtime-surge.json');
const sourceSlotAdapterPath = path.join(repoRoot, 'report', 'data', 'slot-adapter.json');
const sourceListedStocksPath = path.join(repoRoot, 'report', 'data', 'listed-stocks.json');
const publicDataDir = path.join(repoRoot, 'public', 'report', 'data');
const outputSlotAdapterPath = path.join(publicDataDir, 'slot-adapter.json');
const outputRealtimePath = path.join(publicDataDir, 'realtime-surge.json');

const REPORT_TIMEZONE = 'Asia/Seoul';
const ANALYST_PROVIDER = process.env.ANALYST_PROVIDER ?? 'openrouter';
const ANALYST_MODEL = process.env.ANALYST_MODEL ?? 'openrouter/free';
const FALLBACK_PROVIDER = process.env.ANALYST_FALLBACK_PROVIDER ?? 'openrouter';
const FALLBACK_MODEL = process.env.ANALYST_FALLBACK_MODEL ?? 'deepseek/deepseek-v4-flash';
const LLM_TIMEOUT_MS = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? '45000', 10);
const GOOGLE_NEWS_TIMEOUT_MS = Number.parseInt(process.env.GOOGLE_NEWS_TIMEOUT_MS ?? '20000', 10);
const REALTIME_POLISH_BATCH_SIZE = Number.parseInt(process.env.REALTIME_POLISH_BATCH_SIZE ?? '5', 10);
const REALTIME_FRESH_BATCH_SIZE = Number.parseInt(process.env.REALTIME_FRESH_BATCH_SIZE ?? '2', 10);
const REALTIME_VISIBLE_LIMIT = Number.parseInt(process.env.REALTIME_VISIBLE_LIMIT ?? '20', 10);
const REALTIME_GOOGLE_BACKFILL_COMPANY_LIMIT = Number.parseInt(process.env.REALTIME_GOOGLE_BACKFILL_COMPANY_LIMIT ?? '20', 10);
const REALTIME_GOOGLE_BACKFILL_ARTICLES_PER_COMPANY = Number.parseInt(process.env.REALTIME_GOOGLE_BACKFILL_ARTICLES_PER_COMPANY ?? '2', 10);
const MARKET_RESEARCH_WRITER = {
  provider: 'market-research-news',
  model: 'rule-based-extractor-v1'
};
const TELEGRAM_PUBLIC_WRITER = {
  provider: 'telegram-public-web',
  model: 'rule-based-scraper-v1'
};
const TELEGRAM_PUBLIC_CHANNELS = [
  'YeouidoStory2',
  'bumgore',
  'givme23',
  'TNBfolio',
  'Yeouido_Lab',
  'JCxTB',
  'Ten_level',
  'lim_econ',
  'hedgecat0301',
  'huhpharm',
  'capitalmosquito',
  'JgrowthInv',
  'ivy77788',
  'DorisDD2033',
  'fourgachi',
  'bioksm',
  'gatubang',
  'free_life59',
  'nje2e',
  'silverman_sachs',
  'jeilstock',
  'investment_puzzle',
  'd_ticker',
  'merITz_tech',
  'rafikiresearch',
  'jake8lee',
  'desperatestudycafe',
  'habit4117',
  'hogniel'
];
const STOCK_CODE_ALIASES = new Map([
  ['엔에이치스팩33호', 'NH스팩33호'],
  ['마키나락스', '마키나락스'],
  ['소룩스', '소룩스'],
  ['ISC', 'ISC'],
  ['SK스퀘어', 'SK스퀘어']
]);
const POLISHED_HEADLINE_MAX = 70;
const POLISHED_BODY_MIN = 120;
const POLISHED_BODY_MAX = 320;

const COMPANY_STOPWORDS = new Set([
  '오늘의', '주목주', '특징주', '마감', '증시', '시장', '전망', '코스피', '코스닥', 'AI', 'MY',
  '국채금리', '금리', '유가', '기관', '외국인', '개인', '상장', '첫날', '단독', '검토', '소식',
  '소식에', '우려', '기대', '열풍', '회복', '안착', '시험대', '직행', '역봉쇄', '호르무즈',
  '강세', '약세', '급등', '급락', '상승', '하락', '상한가', '하한가', '반등', '랠리', '완판',
  '국민성장펀드', '뉴스핌', '비즈니스포스트', '조선비즈', 'Chosunbiz', 'KB', 'Think', '주가'
]);

const NON_COMPANY_TOKENS = new Set([
  '기술주', '반도체주', '증시', '코스피', '코스닥', '기관', '외국인', '개인', '수급',
  '소폭', '급등주', '급락주', '상승세', '하락세', '상승', '하락', '반등', '급등', '급락',
  '쇼크', '매수', '휘청', '지수', '일제히', '엔비디아',
  '이란', '미국', '중국', '일본', '홍콩', '유럽', '호르무즈', '협상', '기대', '시험대'
]);

function loadListedStocksLookup() {
  try {
    const payload = JSON.parse(readFileSync(sourceListedStocksPath, 'utf8'));
    const lookup = new Map(Object.entries(payload?.lookup ?? {}));
    for (const [alias, canonical] of STOCK_CODE_ALIASES.entries()) {
      const normalizedCanonical = normalizeCompanyName(canonical);
      const code = lookup.get(normalizedCanonical)
        ?? lookup.get(normalizedCanonical.replace(/\s+/gu, ''))
        ?? lookup.get(normalizedCanonical.toUpperCase());
      if (code) {
        lookup.set(normalizeCompanyName(alias), code);
        lookup.set(normalizeCompanyName(alias).replace(/\s+/gu, ''), code);
      }
    }
    return lookup;
  } catch {
    return new Map();
  }
}

const LISTED_STOCK_LOOKUP = loadListedStocksLookup();

function getKstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function formatKstHuman(date) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function resolveSlotHour() {
  const raw = process.env.REALTIME_SLOT_HOUR;
  const fallbackHour = Number.parseInt(getKstParts().hour, 10);
  const parsed = Number.parseInt(String(raw ?? fallbackHour), 10);
  if (!SLOT_HOURS.includes(parsed)) {
    throw new Error(`Unsupported realtime slot hour: ${raw ?? fallbackHour}`);
  }
  return parsed;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isTelegramSource(value) {
  return /^Telegram\b/iu.test(cleanText(value));
}

function truncateSentence(value, maxLength) {
  const text = cleanText(value);
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function trimBody(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (text.length <= POLISHED_BODY_MAX) return text;
  return `${text.slice(0, POLISHED_BODY_MAX - 1).trimEnd()}…`;
}

function sanitizeNarrativeText(value) {
  return cleanText(value)
    .replace(/\[[^\]]{0,40}\]/gu, ' ')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/Telegram\s*@[\w_]+/giu, ' ')
    .replace(/\b(비즈니스포스트|뉴스핌|조선비즈|Chosunbiz|연합뉴스|매일경제|한국경제|머니투데이|이데일리|아시아경제|서울경제|파이낸셜뉴스)\b/giu, ' ')
    .replace(/[📌📋🔔☞▶🔑🤖💰📈🏦🛡⚠️🌏]/gu, ' ')
    .replace(/\b\d+️⃣/gu, ' ')
    .replace(/\([^)]{0,24}\)/gu, (matched) => /\d{4,6}/u.test(matched) ? ' ' : matched)
    .replace(/\s*[:：]\s*/gu, ' ')
    .replace(/\s*[|/]\s*/gu, ' ')
    .replace(/\s*-\s*/gu, '. ')
    .replace(/\s+/gu, ' ')
    .replace(/([.!?])\s*,\s*/gu, '$1 ')
    .replace(/\s+([,.!?])/gu, '$1')
    .replace(/^[,.;:·…\s]+/gu, '')
    .trim();
}

function hasKoreanBatchim(value) {
  const chars = [...cleanText(value)];
  const last = chars.at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function topicParticle(value) {
  return hasKoreanBatchim(value) ? '은' : '는';
}

function cleanLeadClause(value) {
  return cleanText(value)
    .replace(/^[,.;:·…\s]+/gu, '')
    .replace(/\s+([,.!?])/gu, '$1')
    .trim();
}

function normalizeSentenceText(value) {
  return cleanLeadClause(value)
    .replace(/[.!?]+$/u, '')
    .trim();
}

function pushUniqueSentence(sentences, value) {
  const text = normalizeSentenceText(value);
  if (!text || text.length < 8) return;
  const key = text.slice(0, 24);
  if (sentences.some((sentence) => sentence.includes(key))) return;
  sentences.push(`${text}.`);
}

function countDetailSentences(value) {
  return String(value ?? '')
    .split(/[.!?]\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function splitNarrativeClauses(value) {
  return sanitizeNarrativeText(value)
    .split(/[.!?]\s+|▶|☞|(?:\s+\d+\.\s+)|(?:\s+[가-힣A-Za-z0-9]+(?:은|는|이|가)\s+)/u)
    .map((part) => cleanText(part))
    .filter((part) => part && part.length >= 12 && !/^https?/iu.test(part));
}

function pickLeadClause(value, stockName, maxLength = 90) {
  const clauses = splitNarrativeClauses(value);
  for (const clause of clauses) {
    const normalized = cleanLeadClause(clause.replace(new RegExp(`^${stockName}\\s*`, 'u'), ''));
    if (!normalized) continue;
    return truncateSentence(normalized, maxLength);
  }
  const fallback = cleanLeadClause(sanitizeNarrativeText(value).replace(new RegExp(`^${stockName}\\s*`, 'u'), ''));
  return truncateSentence(fallback, maxLength);
}

function stripPublisher(title) {
  return cleanText(title).replace(/\s+-\s+[^-]+$/u, '').trim();
}

function stripHtml(value) {
  return decodeXml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function directionForKeyword(keyword) {
  return /하한가|급락|하락|약세|내려/u.test(keyword) ? 'down' : 'up';
}

function findTargetNamePositions(text, stockName) {
  const target = cleanText(stockName);
  if (!target) return [];
  const positions = [];
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(target, offset);
    if (index === -1) break;
    positions.push(index);
    offset = index + target.length;
  }
  return positions;
}

function nearestDistance(index, positions) {
  if (!positions.length) return Number.POSITIVE_INFINITY;
  return Math.min(...positions.map((position) => Math.abs(index - position)));
}

function inferDirection(text, stockName = null) {
  const directionMatches = [...String(text ?? '').matchAll(/하한가|급락|하락|약세|내려|상한가|급등|상승|강세|반등|랠리|따따블|직행/gu)];
  if (!directionMatches.length) return 'neutral';

  const targetPositions = findTargetNamePositions(String(text ?? ''), stockName);
  if (targetPositions.length) {
    const nearest = directionMatches
      .map((match) => ({
        keyword: match[0],
        distance: nearestDistance(match.index ?? 0, targetPositions)
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    return directionForKeyword(nearest.keyword);
  }

  if (/(하한가|급락|하락|약세|내려)/u.test(text)) return 'down';
  if (/(상한가|급등|상승|강세|반등|랠리|따따블|직행)/u.test(text)) return 'up';
  return 'neutral';
}

function inferChangeRate(text, direction, stockName = null) {
  if (/따따블/u.test(text)) return 300;
  if (/상한가/u.test(text)) return 30;
  if (/하한가/u.test(text)) return -30;

  const matches = [...String(text ?? '').matchAll(/(\d+(?:\.\d+)?)%\s*대?\s*(급등|급락|상승|하락|강세|약세|내려)/gu)];
  const targetPositions = findTargetNamePositions(String(text ?? ''), stockName);
  const matched = targetPositions.length && matches.length
    ? matches
        .map((match) => ({
          match,
          distance: nearestDistance(match.index ?? 0, targetPositions)
        }))
        .sort((a, b) => a.distance - b.distance)[0]?.match
    : matches[0];
  if (matched) {
    const value = Number.parseFloat(matched[1]);
    return ['급락', '하락', '약세', '내려'].includes(matched[2]) ? -value : value;
  }

  const fallback = text.match(/(\d+(?:\.\d+)?)%/u);
  if (!fallback) return null;
  const value = Number.parseFloat(fallback[1]);
  if (direction === 'down') return -value;
  if (direction === 'up') return value;
  return null;
}

function isPlausibleCompanyToken(token) {
  if (!token) return false;
  if (COMPANY_STOPWORDS.has(token)) return false;
  if (NON_COMPANY_TOKENS.has(token)) return false;
  if (token.length < 2 || token.length > 20) return false;
  if (!/[가-힣A-Za-z]/u.test(token)) return false;
  if (/^\d{1,5}$/u.test(token)) return false;
  if (/^\d+(?:\.\d+)?[가-힣]+$/u.test(token)) return false;
  if (/\d/u.test(token) && /(선|대|%|조|억)$/u.test(token)) return false;
  if (/^[A-Z]{1,2}$/u.test(token)) return false;
  if (/^(오늘|특징주|마감|증시|기관|외국인|코스피|코스닥)$/u.test(token)) return false;
  return true;
}

function normalizeCompanyName(token) {
  return cleanText(token)
    .replace(/[,'"“”‘’()\[\]]/gu, '')
    .replace(/^(주식회사|㈜)/u, '')
    .replace(/(은|는|이|가|도|을|를|에|서|로|과|와|만)$/u, '')
    .trim();
}

function normalizeSearchText(value) {
  return stripHtml(value).replace(/\s+/gu, '').toLowerCase();
}

function getPreferredStockCode(stockName, currentCode = null) {
  const existing = cleanText(currentCode);
  if (existing) return existing;

  const normalized = normalizeCompanyName(stockName);
  if (!normalized) return null;

  return LISTED_STOCK_LOOKUP.get(normalized)
    ?? LISTED_STOCK_LOOKUP.get(normalized.replace(/\s+/gu, ''))
    ?? LISTED_STOCK_LOOKUP.get(normalized.toUpperCase())
    ?? null;
}

function extractCompanyName(headline) {
  const cleanHeadline = stripPublisher(headline).replace(/^\[[^\]]+\]\s*/u, '').trim();
  const prioritizedPatterns = [
    /([A-Za-z0-9가-힣&]+)\(\d{4,6}\)\s*(상한가|하한가|급등|급락|강세|약세|상승|하락|직행|내려)/u,
    /([A-Za-z0-9가-힣&]+)[^,·…]*따따블/u,
    /[“"'‘’][^“"'‘’]+[”"'‘’]\s*([A-Za-z0-9가-힣&]+)(?:\s+주가)?(?:은|는|도)?\s*(?:한때\s*)?(?:\d+(?:\.\d+)?%대?\s*)?(상한가|하한가|급등|급락|강세|약세|상승|하락|직행|내려)/u,
    /소식에[^\w가-힣A-Za-z0-9]*([A-Za-z0-9가-힣&]+)\s*(?:한때\s*)?(?:\d+(?:\.\d+)?%대?\s*)?(급등|급락|상승|하락)/u
  ];

  for (const pattern of prioritizedPatterns) {
    const matched = cleanHeadline.match(pattern);
    const normalized = normalizeCompanyName(matched?.[1] ?? '');
    if (isPlausibleCompanyToken(normalized)) return normalized;
  }

  const keywordMatches = [...cleanHeadline.matchAll(/([A-Za-z0-9가-힣&]+)(?:\s+주가)?(?:은|는|도)?\s*(?:한때\s*)?(?:\d+(?:\.\d+)?%대?\s*)?(상한가|하한가|급등|급락|강세|약세|상승|하락|직행|내려)/gu)];
  for (const match of keywordMatches.reverse()) {
    const normalized = normalizeCompanyName(match[1]);
    if (isPlausibleCompanyToken(normalized)) return normalized;
  }

  const tokens = cleanHeadline
    .split(/[\s,·…:;!?/]+/u)
    .map(normalizeCompanyName)
    .filter(isPlausibleCompanyToken);

  const mappedToken = tokens.find((token) => Boolean(getPreferredStockCode(token)));
  if (mappedToken) return mappedToken;

  return tokens[0] ?? null;
}

function toArticleCandidate(article, index) {
  const headline = stripPublisher(article.title);
  const companyName = normalizeCompanyName(article.companyName ?? '') || extractCompanyName(headline);
  if (!companyName) return null;

  const direction = inferDirection(headline, companyName);
  const changeRate = inferChangeRate(headline, direction, companyName);
  const publishedAt = article.publishedAt ? new Date(article.publishedAt) : null;
  const recencyHours = publishedAt ? Math.max(0, (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60)) : 999;

  return {
    id: `${companyName}-${index}`,
    companyName,
    stockCode: article.stockCode ?? null,
    headline,
    summary: cleanText(article.summary),
    source: cleanText(article.source),
    sourceUrl: article.sourceUrl,
    publishedAt: article.publishedAt ?? null,
    direction,
    changeRate,
    recencyHours
  };
}

function buildEvidence(articleGroup, displayArticleGroup = articleGroup) {
  const evidence = [];
  const sources = [...new Set(displayArticleGroup.map((item) => item.source).filter(Boolean))];
  if (sources.length) {
    evidence.push(`출처 ${sources.join(', ')} 기반 기사 ${displayArticleGroup.length}건`);
  }

  const directionEvidence = articleGroup.find((item) => item.changeRate != null || item.direction !== 'neutral');
  if (directionEvidence?.changeRate != null) {
    evidence.push(`제목 기준 변동률 단서 ${directionEvidence.changeRate > 0 ? '+' : ''}${directionEvidence.changeRate.toFixed(1)}%`);
  } else if (directionEvidence?.direction && directionEvidence.direction !== 'neutral') {
    evidence.push(directionEvidence.direction === 'up' ? '상승/강세 키워드 우세' : '하락/약세 키워드 우세');
  }

  for (const item of displayArticleGroup.slice(0, 2)) {
    evidence.push(item.headline);
  }

  return [...new Set(evidence)].slice(0, 4);
}

function computeMentionScore(articleGroup) {
  const newest = articleGroup[0];
  const articleCount = articleGroup.length;
  const sourceCount = new Set(articleGroup.map((item) => item.source)).size;
  const recencyBoost = newest ? Math.max(0, 36 - newest.recencyHours) : 0;
  const changeBoost = Math.max(...articleGroup.map((item) => Math.abs(item.changeRate ?? 0)), 0);
  const keywordBoost = articleGroup.some((item) => /상한가|하한가|따따블/u.test(item.headline)) ? 18 : 0;

  return Number(Math.min(99.9, articleCount * 18 + sourceCount * 8 + recencyBoost + changeBoost * 1.2 + keywordBoost).toFixed(1));
}

function buildSignal(companyName, articleGroup, slotLabel, generatedAt) {
  const newest = articleGroup[0];
  const newsArticles = articleGroup.filter((item) => item?.sourceUrl && !isTelegramSource(item.source));
  const displayArticles = newsArticles.length ? newsArticles : articleGroup;
  const newestDisplay = displayArticles[0];
  const direction = newestDisplay?.direction ?? newest?.direction ?? 'neutral';
  const sentimentLabel = direction === 'up' ? 'positive' : direction === 'down' ? 'negative' : 'neutral';
  const headlineSummary = newestDisplay?.summary || newestDisplay?.headline || `${companyName} 관련 기사 흐름이 포착됐습니다.`;
  const supportingHeadline = displayArticles.find((item) => item.headline && item.headline !== newestDisplay?.headline)?.headline ?? null;
  const evidencePoints = buildEvidence(articleGroup, displayArticles);
  const mentionScore = computeMentionScore(articleGroup);
  const relatedPosts = displayArticles
    .filter((item) => item.sourceUrl)
    .slice(0, 3)
    .map((item, index) => ({
      label: `관련기사${index + 1}`,
      title: item.headline,
      source: item.source,
      url: item.sourceUrl
    }));

  return {
    stockName: companyName,
    stockCode: getPreferredStockCode(
      companyName,
      newestDisplay?.stockCode ?? articleGroup.find((item) => item.stockCode)?.stockCode ?? null
    ),
    summary: supportingHeadline || headlineSummary,
    headline: newestDisplay?.headline ?? `${companyName} 관련 기사 흐름`,
    evidencePoints,
    mentionScore,
    sentimentLabel,
    channelCount: new Set(articleGroup.map((item) => item.source)).size,
    updatedAt: generatedAt,
    cycleLabel: slotLabel.cycleLabel,
    direction,
    changeRate: newestDisplay?.changeRate ?? newest?.changeRate ?? null,
    latestHeadline: newestDisplay?.headline ?? newest?.headline ?? null,
    source: newestDisplay?.source ?? null,
    sourceUrl: newestDisplay?.sourceUrl ?? null,
    publishedAt: newestDisplay?.publishedAt ?? newest?.publishedAt ?? null,
    relatedPosts,
    hasTelegram: articleGroup.some((item) => isTelegramSource(item.source)),
    hasNews: newsArticles.length > 0
  };
}

function getSignalKey(signal) {
  const stockCode = cleanText(signal?.stockCode);
  if (stockCode) return `code:${stockCode}`;
  return `name:${cleanText(signal?.stockName).toLowerCase()}`;
}

function hydrateSignalMetadata(signal) {
  if (!signal || typeof signal !== 'object') return signal;
  const stockName = normalizeCompanyName(signal.stockName ?? '');
  const stockCode = getPreferredStockCode(stockName, signal.stockCode);
  const directionSourceText = signal.headline || signal.latestHeadline || signal.summary || '';
  const inferredDirection = inferDirection(directionSourceText, stockName);
  const direction = inferredDirection !== 'neutral'
    ? inferredDirection
    : typeof signal.changeRate === 'number' && signal.changeRate > 0
      ? 'up'
      : typeof signal.changeRate === 'number' && signal.changeRate < 0
        ? 'down'
        : signal.direction ?? 'neutral';
  const inferredChangeRate = inferChangeRate(directionSourceText, direction, stockName);
  const changeRate = inferredChangeRate ?? signal.changeRate ?? null;
  const sentimentLabel = direction === 'up' ? 'positive' : direction === 'down' ? 'negative' : 'neutral';

  return {
    ...signal,
    stockName,
    stockCode,
    direction,
    changeRate,
    sentimentLabel
  };
}

function isDisplayableSignal(signal) {
  const stockName = normalizeCompanyName(signal?.stockName ?? '');
  if (!isPlausibleCompanyToken(stockName)) return false;
  if (NON_COMPANY_TOKENS.has(stockName)) return false;
  if (!getPreferredStockCode(stockName, signal?.stockCode)) return false;
  return true;
}

function isNewsBackedSignal(signal) {
  if (!signal || typeof signal !== 'object') return false;
  if (signal.hasNews === true) return true;
  const relatedPosts = Array.isArray(signal.relatedPosts) ? signal.relatedPosts : [];
  if (relatedPosts.some((item) => item?.url && !isTelegramSource(item?.source))) return true;
  return Boolean(signal.sourceUrl) && !isTelegramSource(signal.source);
}

function hasNewsBackfillForCompany(companyName, candidates) {
  return candidates.some((item) => item.companyName === companyName && !isTelegramSource(item.source) && item.sourceUrl);
}

function parseGoogleNewsRss(xml) {
  return [...String(xml ?? '').matchAll(/<item>([\s\S]*?)<\/item>/gu)].map((match) => {
    const item = match[1];
    const title = stripHtml(item.match(/<title>([\s\S]*?)<\/title>/u)?.[1]);
    const sourceUrl = decodeXml(item.match(/<link>([\s\S]*?)<\/link>/u)?.[1] ?? '');
    const source = stripHtml(item.match(/<source[^>]*>([\s\S]*?)<\/source>/u)?.[1]);
    const publishedAt = stripHtml(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/u)?.[1]);
    const summary = stripHtml(item.match(/<description>([\s\S]*?)<\/description>/u)?.[1]);
    return { title, summary, source, sourceUrl, publishedAt };
  }).filter((item) => item.title && item.sourceUrl);
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(GOOGLE_NEWS_TIMEOUT_MS),
    headers: {
      accept: 'application/rss+xml,text/xml,text/html,*/*',
      'user-agent': 'Mozilla/5.0 (compatible; HermesRealtimeSurgeBot/1.0)'
    }
  });
  if (!response.ok) {
    throw new Error(`fetch_failed_${response.status}`);
  }
  return response.text();
}

function buildGoogleNewsBackfillCandidates(telegramCandidates, googleNewsItems) {
  const telegramByCompany = new Map();
  for (const candidate of telegramCandidates) {
    if (!candidate?.companyName) continue;
    if (!telegramByCompany.has(candidate.companyName)) telegramByCompany.set(candidate.companyName, candidate);
  }

  const seen = new Set();
  const backfilled = [];
  for (const item of googleNewsItems) {
    const companyName = normalizeCompanyName(item?.companyName ?? '');
    if (!companyName || !telegramByCompany.has(companyName)) continue;
    const baseCandidate = telegramByCompany.get(companyName);
    const key = item.sourceUrl || `${companyName}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    backfilled.push({
      companyName,
      stockCode: baseCandidate?.stockCode ?? null,
      title: cleanText(item.title),
      summary: cleanText(item.summary),
      source: cleanText(item.source),
      sourceUrl: item.sourceUrl,
      publishedAt: item.publishedAt ?? null
    });
  }
  return backfilled;
}

async function fetchGoogleNewsBackfillCandidates(telegramCandidates, existingNewsCandidates) {
  const targetCompanies = [...new Set(
    telegramCandidates
      .map((candidate) => normalizeCompanyName(candidate?.companyName ?? ''))
      .filter(Boolean)
      .filter((companyName) => !hasNewsBackfillForCompany(companyName, existingNewsCandidates))
  )].slice(0, REALTIME_GOOGLE_BACKFILL_COMPANY_LIMIT);

  if (!targetCompanies.length) return [];

  const results = await Promise.allSettled(targetCompanies.map(async (companyName) => {
    const query = `${companyName} 주가`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    const items = parseGoogleNewsRss(await fetchText(url))
      .filter((item) => {
        const haystack = normalizeSearchText(`${item.title} ${item.summary}`);
        const needle = normalizeSearchText(companyName);
        return needle && haystack.includes(needle);
      })
      .slice(0, REALTIME_GOOGLE_BACKFILL_ARTICLES_PER_COMPANY)
      .map((item) => ({ ...item, companyName }));
    return items;
  }));

  const googleNewsItems = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  return buildGoogleNewsBackfillCandidates(telegramCandidates, googleNewsItems);
}

function mergeRealtimeSignals(newSignals, previousSignals, {
  freshBatchSize = REALTIME_FRESH_BATCH_SIZE,
  visibleLimit = REALTIME_VISIBLE_LIMIT
} = {}) {
  const previousList = Array.isArray(previousSignals) ? previousSignals.map(hydrateSignalMetadata) : [];
  const hydratedNewSignals = Array.isArray(newSignals) ? newSignals.map(hydrateSignalMetadata) : [];
  const filteredPreviousList = previousList.filter(isDisplayableSignal).filter(isNewsBackedSignal);
  const previousKeys = new Set(filteredPreviousList.map(getSignalKey));
  const freshSignals = [];
  const targetFreshCount = Math.max(freshBatchSize, visibleLimit - filteredPreviousList.length);

  for (const signal of hydratedNewSignals) {
    if (!isDisplayableSignal(signal)) continue;
    const key = getSignalKey(signal);
    if (previousKeys.has(key)) continue;
    if (freshSignals.some((item) => getSignalKey(item) === key)) continue;
    freshSignals.push(signal);
    if (freshSignals.length >= targetFreshCount) break;
  }

  const freshKeys = new Set(freshSignals.map(getSignalKey));
  const mergedSignals = [
    ...freshSignals,
    ...filteredPreviousList.filter((signal) => !freshKeys.has(getSignalKey(signal)))
  ].slice(0, visibleLimit);

  return { freshSignals, mergedSignals };
}

function assembleFinalSignals(mergedSignals, polishedSignals) {
  const polishedByKey = new Map(
    (Array.isArray(polishedSignals) ? polishedSignals : [])
      .map((signal) => hydrateSignalMetadata(signal))
      .map((signal) => [getSignalKey(signal), signal])
  );

  return (Array.isArray(mergedSignals) ? mergedSignals : [])
    .map((signal) => {
      const hydrated = hydrateSignalMetadata(signal);
      const polished = polishedByKey.get(getSignalKey(hydrated));
      if (polished) {
        const hydratedPolished = hydrateSignalMetadata(polished);
        if (!shouldRefreshPolishedBody(hydratedPolished.polishedBody)) return hydratedPolished;
        return {
          ...hydratedPolished,
          polishedHeadline: cleanText(hydratedPolished.polishedHeadline) || buildFallbackPolish(hydratedPolished).polishedHeadline,
          polishedBody: buildFallbackPolish(hydratedPolished).polishedBody
        };
      }
      if (
        cleanText(hydrated.polishedHeadline)
        && cleanText(hydrated.polishedBody)
        && !shouldRefreshPolishedBody(hydrated.polishedBody)
      ) {
        return hydrated;
      }
      const fallback = buildFallbackPolish(hydrated);
      return {
        ...hydrated,
        polishedHeadline: cleanText(hydrated.polishedHeadline) || fallback.polishedHeadline,
        polishedBody: fallback.polishedBody
      };
    })
    .map(hydrateSignalMetadata)
    .map(normalizeSignalDisplaySources);
}

function buildItemsFromSignals(signals, generatedAt) {
  return signals.map((rawSignal) => {
    const signal = hydrateSignalMetadata(rawSignal);
    return ({
    timestamp: generatedAt,
    symbol: signal.stockCode,
    name: signal.stockName,
    changeRate: signal.changeRate,
    price: null,
    summary: signal.summary,
    source: signal.source,
    sourceUrl: signal.sourceUrl,
    mentionScore: signal.mentionScore,
    evidencePoints: signal.evidencePoints,
    relatedPosts: signal.relatedPosts
    });
  });
}

function buildFallbackPolish(signal) {
  const lead = pickLeadClause(signal.headline || signal.latestHeadline || signal.summary, signal.stockName, POLISHED_HEADLINE_MAX - signal.stockName.length - 1);
  const baseHeadline = truncateSentence(
    lead ? `${signal.stockName} ${lead}`.trim() : `${signal.stockName} 관련 흐름`,
    POLISHED_HEADLINE_MAX
  );

  const sentences = [];
  const summaryLead = pickLeadClause(signal.summary, signal.stockName, 120);
  if (summaryLead) {
    pushUniqueSentence(sentences, `${signal.stockName}${topicParticle(signal.stockName)} ${summaryLead.replace(/\s+했다$/u, '한 상태입니다').replace(/\s+중$/u, ' 중입니다')}`);
  }

  const supportingLead = pickLeadClause(signal.headline, signal.stockName, 120);
  if (supportingLead && !sentences.some((item) => item.includes(supportingLead.slice(0, 20)))) {
    pushUniqueSentence(sentences, supportingLead);
  }

  const relatedTitles = Array.isArray(signal.relatedPosts)
    ? signal.relatedPosts
        .filter((item) => !isTelegramSource(item?.source))
        .map((item) => pickLeadClause(item?.title, signal.stockName, 96))
        .filter(Boolean)
    : [];
  for (const title of relatedTitles) {
    pushUniqueSentence(sentences, title);
    if (sentences.length >= 4) break;
  }

  if (typeof signal.changeRate === 'number' && !Number.isNaN(signal.changeRate)) {
    const sign = signal.changeRate > 0 ? '+' : '';
    pushUniqueSentence(sentences, `${signal.stockName} 관련 제목에는 ${sign}${signal.changeRate.toFixed(1)}% 변동률 표현이 함께 포함됐습니다`);
  }

  const sources = [
    signal.source,
    ...(Array.isArray(signal.relatedPosts) ? signal.relatedPosts.map((item) => item?.source) : [])
  ]
    .map((item) => cleanText(item))
    .filter((item) => item && !isTelegramSource(item));
  const uniqueSources = [...new Set(sources)].slice(0, 2);
  if (uniqueSources.length) {
    pushUniqueSentence(sentences, `관련 기사 흐름을 기준으로 ${signal.stockName} 설명을 정리했습니다`);
  }

  if (signal.direction === 'up') {
    pushUniqueSentence(sentences, `${signal.stockName} 카드는 상승 재료가 제목과 요약에 직접 연결된 경우로 분류했습니다`);
  } else if (signal.direction === 'down') {
    pushUniqueSentence(sentences, `${signal.stockName} 카드는 하락 또는 부담 요인이 제목과 요약에 직접 연결된 경우로 분류했습니다`);
  } else {
    pushUniqueSentence(sentences, `${signal.stockName} 카드는 방향성이 엇갈리거나 확인 근거가 제한적인 중립 흐름으로 분류했습니다`);
  }

  const polishedBody = sentences.slice(0, 5).join(' ');

  return {
    polishedHeadline: baseHeadline,
    polishedBody: trimBody(polishedBody || `${signal.stockName} 관련 근거 기사를 통해 흐름을 확인할 수 있습니다.`)
  };
}

function hasFallbackBoilerplate(value) {
  const text = String(value ?? '');
  return text.includes('관련 기사 링크에서 세부 근거를 추가로 확인할 수 있습니다')
    || text.includes('단기 급등 배경은 기사 본문과 추가 공시 흐름을 함께 보며 확인하는 편이 안전합니다')
    || text.includes('기사 제목과 요약에서 확인됐습니다')
    || text.includes('표시 문구는')
    || text.includes('채널 또는 기사에서 관련 언급이 겹쳤습니다')
    || text.includes('제목 기준 변동 단서는')
    || /[은는]\s*,/u.test(text)
    || /[.!?]\s*,/u.test(text);
}

function shouldRefreshPolishedBody(value) {
  const text = cleanText(value);
  return !text || hasFallbackBoilerplate(text) || countDetailSentences(text) < 4;
}

function refreshRealtimeDescriptions(payload, generatedAt = new Date().toISOString()) {
  const signals = Array.isArray(payload?.signals) ? payload.signals : [];
  const refreshedSignals = signals.map((signal) => {
    const hydrated = hydrateSignalMetadata(signal);
    const fallback = buildFallbackPolish(hydrated);
    return {
      ...hydrated,
      polishedBody: fallback.polishedBody
    };
  });
  return {
    ...payload,
    generated_at: generatedAt,
    signals: refreshedSignals,
    items: buildItemsFromSignals(refreshedSignals, generatedAt),
    state: refreshedSignals.length ? 'loaded' : 'empty',
    polishWriter: {
      provider: 'rule-based-description-refresh',
      model: 'realtime-description-v2',
      fallbackReason: null
    }
  };
}

function normalizeSignalDisplaySources(signal) {
  if (!signal || typeof signal !== 'object') return signal;
  const relatedPosts = Array.isArray(signal.relatedPosts)
    ? signal.relatedPosts.filter((item) => item?.url && !isTelegramSource(item?.source))
    : [];
  if (!isTelegramSource(signal.source)) {
    return {
      ...signal,
      relatedPosts
    };
  }
  const primary = relatedPosts[0] ?? null;
  return {
    ...signal,
    source: primary?.source ?? signal.source,
    sourceUrl: primary?.url ?? signal.sourceUrl,
    relatedPosts
  };
}

function buildRealtimePolishPrompt(signals) {
  const payload = signals.map((signal) => ({
    stockName: signal.stockName,
    stockCode: signal.stockCode,
    headline: truncateSentence(signal.headline, 140),
    summary: truncateSentence(signal.summary, 180),
    relatedPosts: signal.relatedPosts?.slice(0, 2).map((item) => ({
      title: truncateSentence(item.title, 100),
      source: item.source
    })),
    direction: signal.direction,
    changeRate: signal.changeRate,
    channelCount: signal.channelCount
  }));

  return [
    'Return only valid JSON.',
    'Use only the provided facts.',
    'Do not add any investment advice or unsupported claims.',
    'For each item return: stockName, polishedHeadline, polishedBody.',
    `polishedHeadline: Korean plain text, concise summary style, max ${POLISHED_HEADLINE_MAX} characters, intended for bold 1-2 lines.`,
    `polishedBody: Korean explanatory prose, 3-4 sentences, ${POLISHED_BODY_MIN}-${POLISHED_BODY_MAX} characters, intended for about 5-6 mobile lines.`,
    'Remove source/publisher clutter, duplicate phrases, raw channel labels, and noisy ticker boilerplate.',
    'Keep concrete nouns and causal facts if present.',
    '',
    JSON.stringify({ signals: payload })
  ].join('\n');
}

function extractJsonBlock(raw) {
  const text = String(raw ?? '').trim();
  const objectMatch = text.match(/\{[\s\S]*\}$/u);
  if (objectMatch) return objectMatch[0];
  const arrayMatch = text.match(/\[[\s\S]*\]$/u);
  if (arrayMatch) return arrayMatch[0];
  return text;
}

function chunkSignalsForPolish(signals, size = REALTIME_POLISH_BATCH_SIZE) {
  const batchSize = Math.max(1, size);
  const chunks = [];
  for (let index = 0; index < signals.length; index += batchSize) {
    chunks.push(signals.slice(index, index + batchSize));
  }
  return chunks;
}

function extractGeminiText(body) {
  return body?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? '').join('') ?? '';
}

function normalizePolishedResponse(payload, fallbackSignals) {
  const rows = Array.isArray(payload?.signals) ? payload.signals : Array.isArray(payload) ? payload : [];
  const byStock = new Map(rows.map((item) => [cleanText(item?.stockName), item]));

  return fallbackSignals.map((signal) => {
    const fallback = buildFallbackPolish(signal);
    const polished = byStock.get(cleanText(signal.stockName));
    const polishedHeadline = truncateSentence(polished?.polishedHeadline || fallback.polishedHeadline, POLISHED_HEADLINE_MAX);
    const polishedBody = trimBody(polished?.polishedBody || fallback.polishedBody);
    if (!polishedBody || polishedBody.length < POLISHED_BODY_MIN) {
      return fallback;
    }
    return {
      polishedHeadline: polishedHeadline || fallback.polishedHeadline,
      polishedBody
    };
  });
}

function buildOpenRouterPolishRequest(prompt, model = ANALYST_MODEL) {
  return {
    model,
    messages: [
      {
        role: 'system',
        content: 'Return only valid JSON. Use only provided data. No investment advice.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    max_tokens: 1400
  };
}

async function callOpenRouterPolish(prompt, fallbackSignals, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('missing_openrouter_api_key');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'http-referer': process.env.OPENROUTER_SITE_URL ?? 'https://thirdtype-dev.github.io',
      'x-title': process.env.OPENROUTER_APP_TITLE ?? 'Maedo Signal Realtime Surge'
    },
    body: JSON.stringify(buildOpenRouterPolishRequest(prompt, options.model ?? ANALYST_MODEL))
  });

  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`openrouter_polish_failed_${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return normalizePolishedResponse(JSON.parse(extractJsonBlock(JSON.parse(body)?.choices?.[0]?.message?.content ?? '')), fallbackSignals);
}

function getFallbackOpenRouterApiKey() {
  return process.env.OPENROUTER_FALLBACK_API_KEY ?? process.env.OPENROUTER_API_KEY;
}

async function callOpenRouterFallbackPolish(prompt, fallbackSignals) {
  const apiKey = getFallbackOpenRouterApiKey();
  if (!apiKey) throw new Error('missing_openrouter_fallback_api_key');
  return callOpenRouterPolish(prompt, fallbackSignals, {
    apiKey,
    model: FALLBACK_MODEL
  });
}

async function polishSignals(signals) {
  if (!Array.isArray(signals) || !signals.length) return { signals, writer: null };

  if (process.env.REALTIME_POLISH_MOCK === '1') {
    return {
      signals: signals.map((signal) => ({
        ...signal,
        ...buildFallbackPolish(signal)
      })),
      writer: { provider: 'mock', model: 'realtime-polish-mock', fallbackReason: null }
    };
  }

  const baseSignals = signals.map((signal) => ({ ...signal }));
  const batches = chunkSignalsForPolish(baseSignals);
  const mergedSignals = [];
  const batchWriters = [];

  for (const [batchIndex, batchSignals] of batches.entries()) {
    const prompt = buildRealtimePolishPrompt(batchSignals);

    try {
      const polished = await callOpenRouterPolish(prompt, batchSignals);
      mergedSignals.push(...batchSignals.map((signal, index) => ({ ...signal, ...polished[index] })));
      batchWriters.push({ provider: ANALYST_PROVIDER, model: ANALYST_MODEL, fallbackReason: null });
      continue;
    } catch (error) {
      console.warn('[realtime-surge] openrouter polish failed; retrying fallback openrouter model', {
        provider: ANALYST_PROVIDER,
        model: ANALYST_MODEL,
        batchIndex: batchIndex + 1,
        batchCount: batches.length,
        batchSize: batchSignals.length,
        error: error?.message ?? String(error)
      });
    }

    try {
      const polished = await callOpenRouterFallbackPolish(prompt, batchSignals);
      mergedSignals.push(...batchSignals.map((signal, index) => ({ ...signal, ...polished[index] })));
      batchWriters.push({ provider: FALLBACK_PROVIDER, model: FALLBACK_MODEL, fallbackReason: 'primary_failed' });
    } catch (fallbackError) {
      console.warn('[realtime-surge] fallback openrouter polish failed; using rule-based fallback', {
        provider: FALLBACK_PROVIDER,
        model: FALLBACK_MODEL,
        batchIndex: batchIndex + 1,
        batchCount: batches.length,
        batchSize: batchSignals.length,
        error: fallbackError?.message ?? String(fallbackError)
      });
      mergedSignals.push(...batchSignals.map((signal) => ({ ...signal, ...buildFallbackPolish(signal) })));
      batchWriters.push({ provider: 'rule-based-fallback', model: 'signal-polish-v1', fallbackReason: 'all_failed' });
    }
  }

  const providers = [...new Set(batchWriters.map((writer) => writer.provider))];
  if (providers.length === 1) {
    return { signals: mergedSignals, writer: batchWriters[0] };
  }

  const fallbackReasons = [...new Set(batchWriters.map((writer) => writer.fallbackReason).filter(Boolean))];
  return {
    signals: mergedSignals,
    writer: {
      provider: 'mixed',
      model: [...new Set(batchWriters.map((writer) => writer.model))].join(', '),
      fallbackReason: fallbackReasons.includes('all_failed') ? 'mixed_with_fallback' : 'partial_primary_failed'
    }
  };
}

function buildRealtimePayload(articleSource, slotHour, generatedAt, generatedDate, options = {}) {
  const slotLabel = SLOT_LABELS[slotHour];
  const candidates = (articleSource.stockNewsCandidates ?? [])
    .map(toArticleCandidate)
    .filter(Boolean)
    .sort((left, right) => left.recencyHours - right.recencyHours);

  const grouped = new Map();
  for (const candidate of candidates) {
    const bucket = grouped.get(candidate.companyName) ?? [];
    bucket.push(candidate);
    grouped.set(candidate.companyName, bucket);
  }

  const signals = [...grouped.entries()]
    .map(([companyName, articleGroup]) => buildSignal(companyName, articleGroup, slotLabel, generatedAt))
    .map(hydrateSignalMetadata)
    .filter((signal) => signal.hasNews)
    .filter(isDisplayableSignal)
    .sort((left, right) => {
      const leftPriority = left.hasTelegram ? 1 : 0;
      const rightPriority = right.hasTelegram ? 1 : 0;
      if (rightPriority !== leftPriority) return rightPriority - leftPriority;
      return right.mentionScore - left.mentionScore;
    })
    .slice(0, options.maxSignals ?? 10);

  const items = buildItemsFromSignals(signals, generatedAt);

  return {
    generated_at: generatedAt,
    generated_date: generatedDate,
    slot_hour: slotHour,
    cycle_label: slotLabel.cycleLabel,
    slot_label: slotLabel.label,
    state: signals.length ? 'loaded' : 'empty',
    summary: {
      title: `KST ${slotLabel.label} 실시간 급등`,
      subtitle: `${options.subtitlePrefix ?? '시장 뉴스 기반'} 급등 후보 ${signals.length}건`,
      basedOn: options.basedOn ?? 'market-research stock news candidates'
    },
    signals,
    items,
    writer: options.writer ?? MARKET_RESEARCH_WRITER
  };
}

async function loadTelegramSource() {
  const fixtureDir = process.env.REALTIME_TELEGRAM_FIXTURE_DIR;
  const results = await Promise.allSettled(
    TELEGRAM_PUBLIC_CHANNELS.map((channel) => fetchTelegramPublicMessages(channel, { fixtureDir }))
  );

  const messages = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  return messages.sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());
}

async function loadPreviousRealtimePayload() {
  try {
    const raw = await fs.readFile(sourceRealtimePath, 'utf8');
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload?.signals) || !payload.signals.length) return null;
    return payload;
  } catch {
    return null;
  }
}

function buildNewsBackfillSeedCandidates(previousSignals) {
  const seeds = [];
  for (const signal of Array.isArray(previousSignals) ? previousSignals : []) {
    if (!signal || typeof signal !== 'object') continue;
    const companyName = normalizeCompanyName(signal.stockName ?? '');
    if (!companyName || !signal.stockCode) continue;
    if (isNewsBackedSignal(signal)) continue;
    seeds.push({
      companyName,
      stockCode: signal.stockCode,
      title: cleanText(signal.headline || signal.latestHeadline || signal.summary),
      summary: cleanText(signal.summary),
      source: cleanText(signal.source),
      sourceUrl: signal.sourceUrl ?? null,
      publishedAt: signal.publishedAt ?? null
    });
  }
  return seeds;
}

async function main() {
  const slotHour = resolveSlotHour();
  const slotLabel = SLOT_LABELS[slotHour];
  const now = new Date();
  const kst = getKstParts(now);
  const schedule = SLOT_SCHEDULE[0];

  const generatedAt = now.toISOString();
  const generatedDate = `${kst.year}-${kst.month}-${kst.day}`;
  const previousPayload = await loadPreviousRealtimePayload();

  if (process.env.REALTIME_DESCRIPTION_ONLY === '1') {
    const refreshedPayload = refreshRealtimeDescriptions(previousPayload ?? { signals: [] }, generatedAt);
    let slotAdapter = {};
    try {
      slotAdapter = JSON.parse(await fs.readFile(sourceSlotAdapterPath, 'utf8'));
    } catch {
      slotAdapter = {};
    }
    const refreshedSlotAdapter = {
      ...slotAdapter,
      generatedAt,
      generatedDate,
      kstGeneratedAt: formatKstHuman(now),
      itemCount: refreshedPayload.signals.length,
      polishWriter: refreshedPayload.polishWriter
    };
    await fs.mkdir(publicDataDir, { recursive: true });
    await fs.writeFile(outputSlotAdapterPath, `${JSON.stringify(refreshedSlotAdapter, null, 2)}\n`);
    await fs.writeFile(outputRealtimePath, `${JSON.stringify(refreshedPayload, null, 2)}\n`);
    console.log(JSON.stringify({
      ok: true,
      descriptionOnly: true,
      slotHour,
      cycleLabel: slotLabel.cycleLabel,
      generatedAt,
      signalCount: refreshedPayload.signals.length
    }));
    return;
  }

  const marketResearch = JSON.parse(await fs.readFile(sourceMarketResearchPath, 'utf8'));
  const previousSignals = previousPayload?.signals ?? [];
  const telegramMessages = await loadTelegramSource();
  const telegramCandidates = messagesToTelegramNewsCandidates(telegramMessages);
  const marketResearchCandidates = Array.isArray(marketResearch.stockNewsCandidates) ? marketResearch.stockNewsCandidates : [];
  const previousBackfillSeeds = buildNewsBackfillSeedCandidates(previousSignals);
  const usingTelegram = telegramCandidates.length > 0;
  const googleNewsBackfillCandidates = (usingTelegram || previousBackfillSeeds.length)
    ? await fetchGoogleNewsBackfillCandidates([...telegramCandidates, ...previousBackfillSeeds], marketResearchCandidates)
    : [];
  const combinedCandidates = [...telegramCandidates, ...googleNewsBackfillCandidates, ...marketResearchCandidates];
  const writer = usingTelegram ? TELEGRAM_PUBLIC_WRITER : MARKET_RESEARCH_WRITER;
  const nextPayload = usingTelegram
    ? buildRealtimePayload({ stockNewsCandidates: combinedCandidates }, slotHour, generatedAt, generatedDate, {
      writer,
      basedOn: 'public telegram channel mentions with market news backfill',
      subtitlePrefix: '공개 텔레그램 채널 기반',
      maxSignals: 40
    })
    : buildRealtimePayload(marketResearch, slotHour, generatedAt, generatedDate, {
      writer,
      basedOn: 'market-research stock news candidates',
      subtitlePrefix: '시장 뉴스 기반',
      maxSignals: 40
    });
  const { freshSignals, mergedSignals } = mergeRealtimeSignals(nextPayload.signals, previousSignals);
  const polishTargets = freshSignals.map(hydrateSignalMetadata);
  const polished = polishTargets.length
    ? await polishSignals(polishTargets)
    : { signals: [], writer: previousPayload?.polishWriter ?? null };
  const finalSignals = assembleFinalSignals(mergedSignals, polished.signals);
  const realtimePayload = {
    ...nextPayload,
    signals: finalSignals,
    items: buildItemsFromSignals(finalSignals, generatedAt),
    state: finalSignals.length ? 'loaded' : 'empty',
    summary: {
      ...nextPayload.summary,
      subtitle: `${nextPayload.summary.subtitle.split(' 급등 후보')[0]} 급등 후보 ${finalSignals.length}건`
    },
    polishWriter: polished.writer
  };
  const normalizedSignals = realtimePayload.signals.map(hydrateSignalMetadata);
  const normalizedRealtimePayload = {
    ...realtimePayload,
    signals: normalizedSignals,
    items: buildItemsFromSignals(normalizedSignals, generatedAt)
  };

  const slotAdapter = {
    schema: 'urn:hermes:slot-adapter:v1',
    scheduleKey: schedule.key,
    cycleLabel: slotLabel.cycleLabel,
    slot: slotLabel.label,
    state: normalizedRealtimePayload.state === 'loaded' ? 'market-open' : normalizedRealtimePayload.state,
    slotHour,
    title: `KST ${slotLabel.label} 슬롯`,
    subtitle: `${slotLabel.label} 기준 실시간 급등 상세 데이터`,
    generatedAt,
    generatedDate,
    kstGeneratedAt: formatKstHuman(now),
    reportRef: './realtime-surge.json',
    itemCount: normalizedRealtimePayload.signals.length,
    writer,
    polishWriter: polished.writer
  };

  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(outputSlotAdapterPath, `${JSON.stringify(slotAdapter, null, 2)}\n`);
  await fs.writeFile(outputRealtimePath, `${JSON.stringify(normalizedRealtimePayload, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    slotHour,
    cycleLabel: slotLabel.cycleLabel,
    generatedAt,
    signalCount: normalizedRealtimePayload.signals.length
  }));
}

await main();

export function __testBuildRealtimePolishPrompt(signals) {
  return buildRealtimePolishPrompt(signals);
}

export function __testChunkSignalsForPolish(signals, size) {
  return chunkSignalsForPolish(signals, size);
}

export function __testBuildOpenRouterPolishRequest(prompt, model) {
  return buildOpenRouterPolishRequest(prompt, model);
}

export function __testMergeRealtimeSignals(newSignals, previousSignals, options) {
  return mergeRealtimeSignals(newSignals, previousSignals, options);
}

export function __testAssembleFinalSignals(mergedSignals, polishedSignals) {
  return assembleFinalSignals(mergedSignals, polishedSignals);
}

export function __testBuildRealtimePayload(articleSource, slotHour, generatedAt, generatedDate, options) {
  return buildRealtimePayload(articleSource, slotHour, generatedAt, generatedDate, options);
}

export function __testBuildFallbackPolish(signal) {
  return buildFallbackPolish(signal);
}

export function __testRefreshRealtimeDescriptions(payload, generatedAt) {
  return refreshRealtimeDescriptions(payload, generatedAt);
}

export function __testBuildGoogleNewsBackfillCandidates(telegramCandidates, googleNewsItems) {
  return buildGoogleNewsBackfillCandidates(telegramCandidates, googleNewsItems);
}

export function __testNormalizeSignalDisplaySources(signal) {
  return normalizeSignalDisplaySources(signal);
}
