import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOT_HOURS, SLOT_LABELS, SLOT_SCHEDULE } from './slot-constants.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourceMarketResearchPath = path.join(repoRoot, 'report', 'data', 'market-research.json');
const publicDataDir = path.join(repoRoot, 'public', 'report', 'data');
const outputSlotAdapterPath = path.join(publicDataDir, 'slot-adapter.json');
const outputRealtimePath = path.join(publicDataDir, 'realtime-surge.json');

const REPORT_TIMEZONE = 'Asia/Seoul';
const WRITER = {
  provider: 'market-research-news',
  model: 'rule-based-extractor-v1'
};

const COMPANY_STOPWORDS = new Set([
  '오늘의', '주목주', '특징주', '마감', '증시', '시장', '전망', '코스피', '코스닥', 'AI', 'MY',
  '국채금리', '금리', '유가', '기관', '외국인', '개인', '상장', '첫날', '단독', '검토', '소식',
  '소식에', '우려', '기대', '열풍', '회복', '안착', '시험대', '직행', '역봉쇄', '호르무즈',
  '강세', '약세', '급등', '급락', '상승', '하락', '상한가', '하한가', '반등', '랠리', '완판',
  '국민성장펀드', '뉴스핌', '비즈니스포스트', '조선비즈', 'Chosunbiz', 'KB', 'Think', '주가'
]);

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

function stripPublisher(title) {
  return cleanText(title).replace(/\s+-\s+[^-]+$/u, '').trim();
}

function inferDirection(text) {
  if (/(하한가|급락|하락|약세|내려)/u.test(text)) return 'down';
  if (/(상한가|급등|상승|강세|반등|랠리|따따블|직행)/u.test(text)) return 'up';
  return 'neutral';
}

function inferChangeRate(text, direction) {
  if (/따따블/u.test(text)) return 300;
  if (/상한가/u.test(text)) return 30;
  if (/하한가/u.test(text)) return -30;

  const matched = text.match(/(\d+(?:\.\d+)?)%\s*대?\s*(급등|급락|상승|하락|강세|약세|내려)/u);
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
  if (token.length < 2 || token.length > 20) return false;
  if (!/[가-힣A-Za-z]/u.test(token)) return false;
  if (/^\d{1,5}$/u.test(token)) return false;
  if (/^[A-Z]{1,2}$/u.test(token)) return false;
  if (/^(오늘|특징주|마감|증시|기관|외국인|코스피|코스닥)$/u.test(token)) return false;
  return true;
}

function normalizeCompanyName(token) {
  return cleanText(token)
    .replace(/[,'"“”‘’()\[\]]/gu, '')
    .replace(/^(주식회사|㈜)/u, '')
    .replace(/(은|는|이|가|도)$/u, '')
    .trim();
}

function extractCompanyName(headline) {
  const cleanHeadline = stripPublisher(headline).replace(/^\[[^\]]+\]\s*/u, '').trim();
  const prioritizedPatterns = [
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

  return tokens[0] ?? null;
}

function toArticleCandidate(article, index) {
  const headline = stripPublisher(article.title);
  const companyName = extractCompanyName(headline);
  if (!companyName) return null;

  const direction = inferDirection(headline);
  const changeRate = inferChangeRate(headline, direction);
  const publishedAt = article.publishedAt ? new Date(article.publishedAt) : null;
  const recencyHours = publishedAt ? Math.max(0, (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60)) : 999;

  return {
    id: `${companyName}-${index}`,
    companyName,
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

function buildEvidence(articleGroup) {
  const evidence = [];
  const sources = [...new Set(articleGroup.map((item) => item.source).filter(Boolean))];
  if (sources.length) {
    evidence.push(`출처 ${sources.join(', ')} 기반 기사 ${articleGroup.length}건`);
  }

  const directionEvidence = articleGroup.find((item) => item.changeRate != null || item.direction !== 'neutral');
  if (directionEvidence?.changeRate != null) {
    evidence.push(`제목 기준 변동률 단서 ${directionEvidence.changeRate > 0 ? '+' : ''}${directionEvidence.changeRate.toFixed(1)}%`);
  } else if (directionEvidence?.direction && directionEvidence.direction !== 'neutral') {
    evidence.push(directionEvidence.direction === 'up' ? '상승/강세 키워드 우세' : '하락/약세 키워드 우세');
  }

  for (const item of articleGroup.slice(0, 2)) {
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
  const direction = newest?.direction ?? 'neutral';
  const sentimentLabel = direction === 'up' ? 'positive' : direction === 'down' ? 'negative' : 'neutral';
  const headlineSummary = newest?.summary || newest?.headline || `${companyName} 관련 기사 흐름이 포착됐습니다.`;
  const evidencePoints = buildEvidence(articleGroup);
  const mentionScore = computeMentionScore(articleGroup);

  return {
    stockName: companyName,
    stockCode: null,
    summary: `${companyName} 관련 기사 ${articleGroup.length}건을 묶은 슬롯 신호입니다. ${headlineSummary}`,
    evidencePoints,
    mentionScore,
    sentimentLabel,
    channelCount: new Set(articleGroup.map((item) => item.source)).size,
    updatedAt: generatedAt,
    cycleLabel: slotLabel.cycleLabel,
    direction,
    changeRate: newest?.changeRate ?? null,
    latestHeadline: newest?.headline ?? null,
    source: newest?.source ?? null,
    sourceUrl: newest?.sourceUrl ?? null,
    publishedAt: newest?.publishedAt ?? null
  };
}

function buildRealtimePayload(marketResearch, slotHour, generatedAt, generatedDate) {
  const slotLabel = SLOT_LABELS[slotHour];
  const candidates = (marketResearch.stockNewsCandidates ?? [])
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
    .sort((left, right) => right.mentionScore - left.mentionScore)
    .slice(0, 6);

  const items = signals.map((signal) => ({
    timestamp: generatedAt,
    symbol: signal.stockCode,
    name: signal.stockName,
    changeRate: signal.changeRate,
    price: null,
    summary: signal.summary,
    source: signal.source,
    sourceUrl: signal.sourceUrl,
    mentionScore: signal.mentionScore,
    evidencePoints: signal.evidencePoints
  }));

  return {
    generated_at: generatedAt,
    generated_date: generatedDate,
    slot_hour: slotHour,
    cycle_label: slotLabel.cycleLabel,
    slot_label: slotLabel.label,
    state: signals.length ? 'loaded' : 'empty',
    summary: {
      title: `KST ${slotLabel.label} 실시간 급등`,
      subtitle: `시장 뉴스 기반 급등 후보 ${signals.length}건`,
      basedOn: 'market-research stock news candidates'
    },
    signals,
    items,
    writer: WRITER
  };
}

async function main() {
  const slotHour = resolveSlotHour();
  const slotLabel = SLOT_LABELS[slotHour];
  const now = new Date();
  const kst = getKstParts(now);
  const schedule = SLOT_SCHEDULE[0];
  const marketResearch = JSON.parse(await fs.readFile(sourceMarketResearchPath, 'utf8'));

  const generatedAt = now.toISOString();
  const generatedDate = `${kst.year}-${kst.month}-${kst.day}`;
  const realtimePayload = buildRealtimePayload(marketResearch, slotHour, generatedAt, generatedDate);

  const slotAdapter = {
    schema: 'urn:hermes:slot-adapter:v1',
    scheduleKey: schedule.key,
    cycleLabel: slotLabel.cycleLabel,
    slot: slotLabel.label,
    state: realtimePayload.state === 'loaded' ? 'market-open' : realtimePayload.state,
    slotHour,
    title: `KST ${slotLabel.label} 슬롯`,
    subtitle: `${slotLabel.label} 기준 실시간 급등 상세 데이터`,
    generatedAt,
    generatedDate,
    kstGeneratedAt: formatKstHuman(now),
    reportRef: './realtime-surge.json',
    itemCount: realtimePayload.signals.length,
    writer: WRITER
  };

  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(outputSlotAdapterPath, `${JSON.stringify(slotAdapter, null, 2)}\n`);
  await fs.writeFile(outputRealtimePath, `${JSON.stringify(realtimePayload, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    slotHour,
    cycleLabel: slotLabel.cycleLabel,
    generatedAt,
    signalCount: realtimePayload.signals.length
  }));
}

await main();
