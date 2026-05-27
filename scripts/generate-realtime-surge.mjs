import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOT_HOURS, SLOT_LABELS, SLOT_SCHEDULE } from './slot-constants.mjs';
import { fetchTelegramPublicMessages, messagesToTelegramNewsCandidates } from './realtime-telegram-public.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourceMarketResearchPath = path.join(repoRoot, 'report', 'data', 'market-research.json');
const sourceRealtimePath = path.join(repoRoot, 'report', 'data', 'realtime-surge.json');
const publicDataDir = path.join(repoRoot, 'public', 'report', 'data');
const outputSlotAdapterPath = path.join(publicDataDir, 'slot-adapter.json');
const outputRealtimePath = path.join(publicDataDir, 'realtime-surge.json');

const REPORT_TIMEZONE = 'Asia/Seoul';
const ANALYST_PROVIDER = process.env.ANALYST_PROVIDER ?? 'openrouter';
const ANALYST_MODEL = process.env.ANALYST_MODEL ?? 'deepseek/deepseek-v4-flash:free';
const FALLBACK_PROVIDER = process.env.ANALYST_FALLBACK_PROVIDER ?? 'gemini';
const FALLBACK_MODEL = process.env.ANALYST_FALLBACK_MODEL ?? 'gemini-2.5-flash';
const LLM_TIMEOUT_MS = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? '45000', 10);
const REALTIME_POLISH_BATCH_SIZE = Number.parseInt(process.env.REALTIME_POLISH_BATCH_SIZE ?? '5', 10);
const REALTIME_FRESH_BATCH_SIZE = Number.parseInt(process.env.REALTIME_FRESH_BATCH_SIZE ?? '5', 10);
const REALTIME_VISIBLE_LIMIT = Number.parseInt(process.env.REALTIME_VISIBLE_LIMIT ?? '20', 10);
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
const STOCK_CODE_OVERRIDES = new Map([
  ['마키나락스', '377480'],
  ['소룩스', '290690'],
  ['LG전자', '066570'],
  ['미래에셋증권', '006800'],
  ['엔에이치스팩33호', '0130H0']
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
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/Telegram\s*@[\w_]+/giu, ' ')
    .replace(/[📌📋🔔☞▶🔑🤖💰📈🏦🛡⚠️🌏]/gu, ' ')
    .replace(/\b\d+️⃣/gu, ' ')
    .replace(/\([^)]{0,24}\)/gu, (matched) => /\d{4,6}/u.test(matched) ? ' ' : matched)
    .replace(/\s*[:：]\s*/gu, ' ')
    .replace(/\s*[|/]\s*/gu, ' ')
    .replace(/\s*-\s*/gu, '. ')
    .replace(/\s+/gu, ' ')
    .trim();
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
    const normalized = clause.replace(new RegExp(`^${stockName}\\s*`, 'u'), '').trim();
    if (!normalized) continue;
    return truncateSentence(normalized, maxLength);
  }
  const fallback = sanitizeNarrativeText(value).replace(new RegExp(`^${stockName}\\s*`, 'u'), '').trim();
  return truncateSentence(fallback, maxLength);
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

  return tokens[0] ?? null;
}

function toArticleCandidate(article, index) {
  const headline = stripPublisher(article.title);
  const companyName = normalizeCompanyName(article.companyName ?? '') || extractCompanyName(headline);
  if (!companyName) return null;

  const direction = inferDirection(headline);
  const changeRate = inferChangeRate(headline, direction);
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
  const supportingHeadline = articleGroup.find((item) => item.headline && item.headline !== newest?.headline)?.headline ?? null;
  const evidencePoints = buildEvidence(articleGroup);
  const mentionScore = computeMentionScore(articleGroup);
  const relatedPosts = articleGroup
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
    stockCode: newest?.stockCode ?? articleGroup.find((item) => item.stockCode)?.stockCode ?? STOCK_CODE_OVERRIDES.get(companyName) ?? null,
    summary: supportingHeadline || headlineSummary,
    headline: newest?.headline ?? `${companyName} 관련 기사 흐름`,
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
    publishedAt: newest?.publishedAt ?? null,
    relatedPosts,
    hasTelegram: articleGroup.some((item) => String(item.source || '').startsWith('Telegram'))
  };
}

function getSignalKey(signal) {
  const stockCode = cleanText(signal?.stockCode);
  if (stockCode) return `code:${stockCode}`;
  return `name:${cleanText(signal?.stockName).toLowerCase()}`;
}

function mergeRealtimeSignals(newSignals, previousSignals, {
  freshBatchSize = REALTIME_FRESH_BATCH_SIZE,
  visibleLimit = REALTIME_VISIBLE_LIMIT
} = {}) {
  const previousList = Array.isArray(previousSignals) ? previousSignals : [];
  const previousKeys = new Set(previousList.map(getSignalKey));
  const freshSignals = [];

  for (const signal of newSignals) {
    const key = getSignalKey(signal);
    if (previousKeys.has(key)) continue;
    if (freshSignals.some((item) => getSignalKey(item) === key)) continue;
    freshSignals.push(signal);
    if (freshSignals.length >= freshBatchSize) break;
  }

  const freshKeys = new Set(freshSignals.map(getSignalKey));
  const mergedSignals = [
    ...freshSignals,
    ...previousList.filter((signal) => !freshKeys.has(getSignalKey(signal)))
  ].slice(0, visibleLimit);

  return { freshSignals, mergedSignals };
}

function buildItemsFromSignals(signals, generatedAt) {
  return signals.map((signal) => ({
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
  }));
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
    sentences.push(`${signal.stockName}는 ${summaryLead.replace(/\s+했다$/u, '한 상태입니다').replace(/\s+중$/u, ' 중입니다')}.`);
  }

  const supportingLead = pickLeadClause(signal.headline, signal.stockName, 120);
  if (supportingLead && !sentences.some((item) => item.includes(supportingLead.slice(0, 20)))) {
    sentences.push(`${supportingLead}.`);
  }

  if (signal.channelCount > 0) {
    sentences.push(`${signal.channelCount}개 채널 또는 기사에서 관련 언급이 겹쳤습니다.`);
  }

  if (typeof signal.changeRate === 'number' && !Number.isNaN(signal.changeRate)) {
    const sign = signal.changeRate > 0 ? '+' : '';
    sentences.push(`제목 기준 변동 단서는 ${sign}${signal.changeRate.toFixed(1)}%입니다.`);
  }

  const relatedTitles = Array.isArray(signal.relatedPosts)
    ? signal.relatedPosts
        .map((item) => pickLeadClause(item?.title, signal.stockName, 96))
        .filter(Boolean)
    : [];
  for (const title of relatedTitles) {
    if (sentences.some((item) => item.includes(title.slice(0, 18)))) continue;
    sentences.push(`${title}.`);
    if (sentences.length >= 4) break;
  }

  let polishedBody = sentences.join(' ');
  if (polishedBody.length < POLISHED_BODY_MIN) {
    polishedBody = `${polishedBody} 관련 기사 링크에서 세부 근거를 추가로 확인할 수 있습니다.`.trim();
  }

  return {
    polishedHeadline: baseHeadline,
    polishedBody: trimBody(polishedBody || `${signal.stockName} 관련 근거 기사를 통해 흐름을 확인할 수 있습니다.`)
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

async function callOpenRouterPolish(prompt, fallbackSignals) {
  const apiKey = process.env.OPENROUTER_API_KEY;
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
    body: JSON.stringify({
      model: ANALYST_MODEL,
      provider: {
        sort: 'throughput'
      },
      messages: [
        {
          role: 'system',
          content: 'Return only valid JSON. Use only provided data. No investment advice.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      max_tokens: 1400,
      response_format: { type: 'json_object' }
    })
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`openrouter_polish_failed_${response.status}`);
  return normalizePolishedResponse(JSON.parse(extractJsonBlock(JSON.parse(body)?.choices?.[0]?.message?.content ?? '')), fallbackSignals);
}

async function callGeminiPolish(prompt, fallbackSignals) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('missing_gemini_api_key');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(FALLBACK_MODEL)}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        maxOutputTokens: 2200
      }
    })
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`gemini_polish_failed_${response.status}`);
  return normalizePolishedResponse(JSON.parse(extractJsonBlock(extractGeminiText(JSON.parse(body)))), fallbackSignals);
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
      console.warn('[realtime-surge] openrouter polish failed; retrying gemini', {
        provider: ANALYST_PROVIDER,
        model: ANALYST_MODEL,
        batchIndex: batchIndex + 1,
        batchCount: batches.length,
        batchSize: batchSignals.length,
        error: error?.message ?? String(error)
      });
    }

    try {
      const polished = await callGeminiPolish(prompt, batchSignals);
      mergedSignals.push(...batchSignals.map((signal, index) => ({ ...signal, ...polished[index] })));
      batchWriters.push({ provider: FALLBACK_PROVIDER, model: FALLBACK_MODEL, fallbackReason: 'primary_failed' });
    } catch (fallbackError) {
      console.warn('[realtime-surge] gemini polish failed; using rule-based fallback', {
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

async function loadPreviousRealtimePayload(generatedDate) {
  try {
    const raw = await fs.readFile(sourceRealtimePath, 'utf8');
    const payload = JSON.parse(raw);
    if (payload?.generated_date !== generatedDate) return null;
    return payload;
  } catch {
    return null;
  }
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
  const telegramMessages = await loadTelegramSource();
  const telegramCandidates = messagesToTelegramNewsCandidates(telegramMessages);
  const marketResearchCandidates = Array.isArray(marketResearch.stockNewsCandidates) ? marketResearch.stockNewsCandidates : [];
  const combinedCandidates = [...telegramCandidates, ...marketResearchCandidates];
  const usingTelegram = telegramCandidates.length > 0;
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
  const previousPayload = await loadPreviousRealtimePayload(generatedDate);
  const previousSignals = previousPayload?.signals ?? [];
  const { freshSignals, mergedSignals } = mergeRealtimeSignals(nextPayload.signals, previousSignals);
  const polished = await polishSignals(freshSignals);
  const polishedFreshSignals = polished.signals;
  const polishedFreshByKey = new Map(polishedFreshSignals.map((signal) => [getSignalKey(signal), signal]));
  const finalSignals = mergedSignals.map((signal) => polishedFreshByKey.get(getSignalKey(signal)) ?? signal);
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
    writer,
    polishWriter: polished.writer
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

export function __testBuildRealtimePolishPrompt(signals) {
  return buildRealtimePolishPrompt(signals);
}

export function __testChunkSignalsForPolish(signals, size) {
  return chunkSignalsForPolish(signals, size);
}

export function __testMergeRealtimeSignals(newSignals, previousSignals, options) {
  return mergeRealtimeSignals(newSignals, previousSignals, options);
}
