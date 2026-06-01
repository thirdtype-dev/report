import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const OUTPUT_DIR = resolve(process.cwd(), 'public/report');
const DATA_DIR = resolve(OUTPUT_DIR, 'data');
const execFileAsync = promisify(execFile);
const ANALYST_PROVIDER = process.env.ANALYST_PROVIDER ?? 'opencode-zen';
const ANALYST_MODEL = process.env.ANALYST_MODEL ?? 'deepseek-v4-flash';
const FALLBACK_PROVIDER = process.env.ANALYST_FALLBACK_PROVIDER ?? 'openrouter';
const FALLBACK_MODEL = process.env.ANALYST_FALLBACK_MODEL ?? 'deepseek/deepseek-v4-flash';
const OPENCODE_ZEN_BASE_URL = process.env.OPENCODE_ZEN_BASE_URL ?? 'https://opencode.ai/zen/v1';
const PHASE = normalizePhase(process.env.BRIEFING_PHASE);
const PUBLIC_REPORT_URL = process.env.PUBLIC_REPORT_URL ?? 'https://thirdtype-dev.github.io/report/';
const ADSENSE_CLIENT = 'ca-pub-3518959293552717';
const INVESTOR_FLOW_TIMEOUT_MS = Number.parseInt(process.env.INVESTOR_FLOW_TIMEOUT_MS ?? '45000', 10);
const LLM_TIMEOUT_MS = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? '45000', 10);
const LLM_MAX_ATTEMPTS = Number.parseInt(process.env.LLM_MAX_ATTEMPTS ?? '3', 10);
const LLM_RETRY_BASE_DELAY_MS = Number.parseInt(process.env.LLM_RETRY_BASE_DELAY_MS ?? '1500', 10);
const ARTICLE_RE = /<article class="[^"]*\breport\b[^"]*\breport-(?:pre|post)-market\b[^"]*">[\s\S]*?<\/article>/g;
const YAHOO_SYMBOLS = [
  { key: 'kospi', title: 'KOSPI', symbol: '^KS11' },
  { key: 'kosdaq', title: 'KOSDAQ', symbol: '^KQ11' },
  { key: 'usdkrw', title: 'USD/KRW', symbol: 'KRW=X' },
  { key: 'nasdaq', title: 'NASDAQ', symbol: '^IXIC' },
  { key: 'sp500', title: 'S&P 500', symbol: '^GSPC' },
  { key: 'nasdaq_futures', title: 'Nasdaq Futures', symbol: 'NQ=F' }
];
const NEWS_QUERIES = [
  '한국 증시 코스피 코스닥 반도체 2차전지',
  '한국 증시 외국인 기관 수급',
  '한국 주식시장 공시 실적 유상증자 M&A',
  '한국 증시 신규상장 보호예수 주주총회'
];
const NOTABLE_STOCK_QUERIES = [
  '오늘 특징주 급등 급락 코스피 코스닥',
  '증시 마감 특징주 상한가 하한가',
  '코스피 특징주 급등 상승 이유',
  '코스닥 특징주 급락 하락 이유',
  '오늘의 특징주 종목 상승 하락',
  '시간외 특징주 급등 급락'
];
const INVESTOR_FLOW_NEWS_QUERIES = [
  '코스피 외국인 기관 순매수 순매도',
  '코스닥 외국인 기관 순매수 순매도',
  '증시 수급 외국인 기관 개인 순매수',
  '외국인 선물 순매수 프로그램 매매',
  '연기금 투신 금융투자 순매수 증시'
];
const DISCLOSURE_NEWS_QUERIES = [
  '장 마감 후 주요 공시 실적 유상증자 무상증자',
  '한국 증시 주요 공시 계약 수주 공급계약',
  '주식 주요 공시 자사주 취득 소각 배당',
  '상장사 주요 공시 합병 인수 분할',
  'DART 주요 공시 실적 전망 정정'
];
const MARKET_SCHEDULE_QUERIES = [
  '오늘 증시 일정 신규상장 보호예수 해제',
  '오늘 공모주 상장 청약 보호예수 해제',
  '증시 주요 일정 주주총회 배당 기준일',
  '오늘 경제지표 발표 증시 일정 한국 미국',
  '오늘 상장폐지 거래정지 변경상장 일정'
];
const SECTOR_THEME_QUERIES = [
  '오늘 강세 업종 약세 업종 코스피 코스닥',
  '증시 마감 업종별 등락률 테마 강세 약세',
  '반도체 2차전지 바이오 자동차 조선 업종 흐름',
  '오늘 테마주 강세 약세 시장 마감',
  '코스피 코스닥 업종별 흐름 마감'
];
const REPORT_STYLE = String.raw`
    :root {
      color-scheme: dark;
      scroll-behavior: smooth;
      --bg: #09111f;
      --panel: rgba(15, 24, 39, 0.92);
      --panel-2: rgba(20, 33, 52, 0.9);
      --line: rgba(148, 163, 184, 0.18);
      --text: #eef5ff;
      --muted: #aab8cc;
      --soft: #d7e4f7;
      --accent: #49d19a;
      --accent-2: #7dd3fc;
      --warn: #f8d477;
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
    }
    body {
      font-family: "Pretendard", "SUIT", "IBM Plex Sans KR", "Apple SD Gothic Neo", sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      color: var(--text);
      background:
        radial-gradient(circle at 12% -10%, rgba(73, 209, 154, 0.22), transparent 34rem),
        radial-gradient(circle at 92% 2%, rgba(125, 211, 252, 0.18), transparent 30rem),
        linear-gradient(145deg, #08101d 0%, #101827 44%, #172035 100%);
      min-height: 100vh;
    }
    .page {
      width: min(920px, 100%);
      margin: 0 auto;
      padding: 18px;
      box-sizing: border-box;
    }
    .room-header {
      position: sticky;
      top: 0;
      z-index: 10;
      margin: -18px -18px 18px;
      padding: 16px 18px 14px;
      border-bottom: 1px solid var(--line);
      background:
        linear-gradient(180deg, rgba(9, 17, 31, 0.96), rgba(9, 17, 31, 0.82)),
        rgba(9, 17, 31, 0.9);
      backdrop-filter: blur(18px);
    }
    .room-title {
      margin: 0 0 14px;
      color: #ffffff;
      font-size: clamp(1.7rem, 6vw, 2.5rem);
      font-weight: 900;
      letter-spacing: -0.06em;
    }
    .room-tabs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 5px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(8, 16, 29, 0.68);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }
    .room-tab {
      appearance: none;
      border: 0;
      border-radius: 999px;
      padding: 10px 12px;
      color: var(--muted);
      background: transparent;
      font: inherit;
      font-size: 0.95rem;
      font-weight: 900;
      letter-spacing: -0.03em;
      cursor: pointer;
    }
    .room-tab.is-active {
      color: #06111e;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      box-shadow: 0 10px 26px rgba(73, 209, 154, 0.22);
    }
    h1, h2, h3 { line-height: 1.25; }
    .meta { color: var(--muted); margin-top: 0; }
    ul { padding-left: 0; }
    .note { background: var(--panel-2); border-left: 4px solid var(--accent-2); padding: 12px 16px; border-radius: 16px; }
    .section { margin-top: 1.5rem; }
    .report {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 24px;
      box-shadow: var(--shadow);
      margin: 0;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)),
        var(--panel);
      backdrop-filter: blur(16px);
    }
    .report::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 5px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--warn));
    }
    .report.report-pre-market {
      border-color: rgba(125, 211, 252, 0.32);
      background:
        linear-gradient(160deg, rgba(14, 165, 233, 0.18), rgba(20, 184, 166, 0.08) 42%, rgba(255,255,255,0.018)),
        var(--panel);
    }
    .report.report-pre-market::before {
      background: linear-gradient(90deg, #38bdf8, #2dd4bf, #a7f3d0);
    }
    .report.report-post-market {
      border-color: rgba(251, 146, 60, 0.34);
      background:
        linear-gradient(160deg, rgba(251, 146, 60, 0.18), rgba(244, 63, 94, 0.09) 44%, rgba(255,255,255,0.018)),
        rgba(25, 21, 33, 0.92);
    }
    .report.report-post-market::before {
      background: linear-gradient(90deg, #fb923c, #f43f5e, #fde68a);
    }
    .report + .report { margin-top: 18px; }
    .issue-time {
      font-weight: 900;
      letter-spacing: 0;
      color: inherit;
    }
    .report > h1 {
      margin: 8px 0 20px;
      font-size: clamp(1.65rem, 5vw, 2.45rem);
      letter-spacing: -0.055em;
      color: #ffffff;
    }
    .report h2 {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 18px 0 10px;
      color: #f8fbff;
      font-size: clamp(1.03rem, 3vw, 1.2rem);
      letter-spacing: -0.035em;
    }
    .report p, .report li { color: var(--soft); }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .eyebrow.published { background: rgba(73, 209, 154, 0.16); color: #a7f3d0; border: 1px solid rgba(73, 209, 154, 0.24); }
    .report-pre-market .eyebrow.published { background: rgba(56, 189, 248, 0.16); color: #bae6fd; border-color: rgba(56, 189, 248, 0.28); }
    .report-post-market .eyebrow.published { background: rgba(251, 146, 60, 0.16); color: #fed7aa; border-color: rgba(251, 146, 60, 0.3); }
    .eyebrow.draft { background: rgba(248, 212, 119, 0.16); color: #fde68a; }
    .small { font-size: 0.95rem; color: var(--muted); }
    code { background: #111827; padding: 0 4px; border-radius: 4px; }
    a { color: #9bdcff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .news-section {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }
    .page > .disclaimer {
      margin: 16px 0 0;
      border-radius: 20px;
    }
    .news-list {
      list-style: none;
      padding-left: 0;
      margin: 0;
      display: grid;
      gap: 8px;
    }
    .brief-list {
      list-style: none;
      margin: 0;
      display: grid;
      gap: 9px;
    }
    .brief-list li {
      display: grid;
      grid-template-columns: minmax(106px, 0.28fr) 1fr;
      gap: 12px;
      align-items: start;
      padding: 13px 14px;
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 18px;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)),
        rgba(8, 16, 29, 0.36);
    }
    .item-label {
      color: #9ee7c4;
      font-size: 0.86rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      word-break: keep-all;
    }
    .report-pre-market .item-label { color: #93e7ff; }
    .report-post-market .item-label { color: #fdba74; }
    .item-value {
      color: #e5eefc;
      font-size: 0.98rem;
      letter-spacing: -0.015em;
    }
    .news-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px;
      border-radius: 14px;
      background: var(--panel-2);
      border: 1px solid var(--line);
    }
    .news-link {
      color: #c8edff;
      font-weight: 600;
      text-decoration: none;
    }
    .news-link:hover { text-decoration: underline; }
    .news-source {
      font-size: 0.88rem;
      color: var(--muted);
    }
    .news-body {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }
    .news-article {
      margin-top: 12px;
      padding: 14px 14px 16px;
      border-radius: 12px;
      background: rgba(8, 16, 29, 0.48);
      border: 1px solid var(--line);
      scroll-margin-top: 8px;
    }
    .news-article h2 {
      margin: 0 0 6px;
      color: #ffffff;
      font-size: 1rem;
    }
    .disclaimer {
      margin-top: 16px;
      padding: 14px 14px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(8, 16, 29, 0.72);
      color: var(--muted);
      font-size: 0.92rem;
    }
    @media (max-width: 640px) {
      .page { padding: 10px; }
      .room-header { margin: -10px -10px 14px; padding: 14px 10px 12px; }
      .room-tab { padding: 9px 10px; font-size: 0.9rem; }
      .report { border-radius: 22px; padding: 18px 14px; }
      .brief-list li { grid-template-columns: 1fr; gap: 4px; }
      .item-label { font-size: 0.82rem; }
    }
`;

const PHASE_CONFIG = {
  pre_market: {
    eyebrow: '장시작 브리핑',
    sessionLabel: '08:30'
  },
  post_market: {
    eyebrow: '장마감 브리핑',
    sessionLabel: '16:00'
  }
};

function normalizePhase(value) {
  if (value === 'post_market' || value === 'post-market' || value === 'close') return 'post_market';
  return 'pre_market';
}

function isQuotaError(error) {
  const text = `${error?.message ?? ''} ${error?.body ?? ''}`.toLowerCase();
  return error?.status === 429 || text.includes('quota') || text.includes('rate limit') || text.includes('resource exhausted');
}

function isTransientLlmError(error) {
  const text = `${error?.message ?? ''} ${error?.body ?? ''}`.toLowerCase();
  return [
    error?.name === 'TimeoutError',
    error?.name === 'AbortError',
    error?.status === 408,
    error?.status === 409,
    error?.status === 425,
    error?.status === 429,
    typeof error?.status === 'number' && error.status >= 500,
    text.includes('timed out'),
    text.includes('timeout'),
    text.includes('temporarily unavailable'),
    text.includes('experiencing high demand'),
    text.includes('please try again later'),
    text.includes('overloaded')
  ].some(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLlmRetry(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= LLM_MAX_ATTEMPTS || !isTransientLlmError(error)) {
        throw error;
      }

      const delayMs = LLM_RETRY_BASE_DELAY_MS * attempt;
      console.warn(`[market-briefing] ${label} transient failure; retrying`, {
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts: LLM_MAX_ATTEMPTS,
        delayMs,
        error: error.message
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function extractJson(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('empty_llm_response');

  const candidates = [
    trimmed,
    ...[...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map((match) => match[1].trim())
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // opencode zen can include reasoning text before the final JSON.
    }
  }

  for (let start = 0; start < trimmed.length; start += 1) {
    const opening = trimmed[start];
    if (opening !== '{' && opening !== '[') continue;
    const closing = opening === '{' ? '}' : ']';
    const stack = [closing];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        stack.push('}');
      } else if (char === '[') {
        stack.push(']');
      } else if (char === stack.at(-1)) {
        stack.pop();
        if (!stack.length) {
          try {
            return JSON.parse(trimmed.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  return JSON.parse(trimmed);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value, minimum = 1) {
  return Array.isArray(value) && value.length >= minimum && value.every((entry) => isNonEmptyString(entry));
}

function validateReportShape(report) {
  const requiredFields = PHASE === 'post_market'
    ? [
        ['marketSummary.kospi', report.marketSummary?.kospi],
        ['marketSummary.kosdaq', report.marketSummary?.kosdaq],
        ['marketSummary.summary', report.marketSummary?.summary],
        ['investorFlows.foreign', report.investorFlows?.foreign],
        ['investorFlows.institution', report.investorFlows?.institution],
        ['investorFlows.retail', report.investorFlows?.retail],
        ['sectorThemes.strong', report.sectorThemes?.strong],
        ['sectorThemes.weak', report.sectorThemes?.weak],
        ['tomorrowStrategy.outlook', report.tomorrowStrategy?.outlook]
      ]
    : [
        ['openingStrategy.keywords', report.openingStrategy?.keywords],
        ['openingStrategy.oneLineStrategy', report.openingStrategy?.oneLineStrategy],
        ['openingStrategy.expectedOpen', report.openingStrategy?.expectedOpen],
        ['investorFlowWatch.continuity', report.investorFlowWatch?.continuity],
        ['investorFlowWatch.keyInvestor', report.investorFlowWatch?.keyInvestor],
        ['investorFlowWatch.checkPoint', report.investorFlowWatch?.checkPoint],
        ['sectorWeather.sunny', report.sectorWeather?.sunny],
        ['sectorWeather.cloudy', report.sectorWeather?.cloudy],
        ['sectorWeather.rainy', report.sectorWeather?.rainy],
        ['disclosuresAndNews.corporateDisclosure', report.disclosuresAndNews?.corporateDisclosure],
        ['disclosuresAndNews.majorNews', report.disclosuresAndNews?.majorNews],
        ['disclosuresAndNews.schedule', report.disclosuresAndNews?.schedule],
        ['watchlist.leaders', report.watchlist?.leaders],
        ['watchlist.technicals', report.watchlist?.technicals],
        ['watchlist.eventDriven', report.watchlist?.eventDriven]
      ];

  const missing = requiredFields
    .filter(([, value]) => !isNonEmptyString(value))
    .map(([label]) => label);

  if (PHASE === 'post_market') {
    if (!isNonEmptyStringArray(report.notableStocks?.surging, 2)) missing.push('notableStocks.surging');
    if (!isNonEmptyStringArray(report.notableStocks?.plunging, 2)) missing.push('notableStocks.plunging');
    if (!isNonEmptyStringArray(report.tomorrowStrategy?.checklist, 3)) missing.push('tomorrowStrategy.checklist');
  }

  if (missing.length > 0) {
    const error = new Error(`invalid_report_shape:${missing.slice(0, 8).join(',')}`);
    error.report = report;
    throw error;
  }

  return report;
}

function reportSchema() {
  if (PHASE === 'post_market') {
    return {
      marketSummary: {
        kospi: '0,000.00 (▲/▼ 0.00%)',
        kosdaq: '0,000.00 (▲/▼ 0.00%)',
        summary: 'string'
      },
      investorFlows: {
        foreign: 'string',
        institution: 'string',
        retail: 'string'
      },
      sectorThemes: {
        strong: 'string',
        weak: 'string'
      },
      notableStocks: {
        surging: ['종목명, 등락률, 상승 사유 요약'],
        plunging: ['종목명, 등락률, 하락 사유 요약']
      },
      tomorrowStrategy: {
        outlook: 'string',
        checklist: ['string', 'string', 'string']
      }
    };
  }

  return {
    openingStrategy: {
      keywords: 'string',
      oneLineStrategy: 'string',
      expectedOpen: 'string'
    },
    investorFlowWatch: {
      continuity: 'string',
      keyInvestor: 'string',
      checkPoint: 'string'
    },
    sectorWeather: {
      sunny: 'string',
      cloudy: 'string',
      rainy: 'string'
    },
    disclosuresAndNews: {
      corporateDisclosure: 'string',
      majorNews: 'string',
      schedule: 'string'
    },
    watchlist: {
      leaders: 'string',
      technicals: 'string',
      eventDriven: 'string'
    }
  };
}

function buildPrompt(marketResearch) {
  const config = PHASE_CONFIG[PHASE];
  return [
    '너는 한국 증시 일일 브리핑을 작성하는 애널리스트다.',
    `브리핑 단계는 ${config.sessionLabel}이다.`,
    '아래 JSON에 포함된 수치와 문장만 근거로 사용한다.',
    '입력 JSON은 공개 데이터 소스(Yahoo Finance chart, Google News RSS, pykrx/KRX 투자자별 거래대금)를 정규화한 것이다.',
    'status가 unavailable인 항목은 확인 필요로 처리하고, 수치나 사실을 추정해 채우지 않는다.',
    '각 문장의 근거는 sources, marketNews, investorFlows, investorFlowNewsCandidates, disclosureNewsCandidates, scheduleNewsCandidates, sectorThemeNewsCandidates, stockNewsCandidates 범위 안에서만 사용한다.',
    '장시작 외국인/기관 수급 관전 포인트는 investorFlows를 우선 사용하고, unavailable이면 investorFlowNewsCandidates에서 수급/선물/프로그램 매매 흐름을 추출해 작성한다.',
    '장마감 투자자별 수급 동향은 investorFlows를 우선 사용하고, unavailable이면 investorFlowNewsCandidates에서 외국인/기관/개인 흐름을 추출해 작성한다.',
    '수급 코멘트가 뉴스 기반일 때는 정확한 순매수 금액을 만들지 말고 "뉴스 기준", "보도 기준" 같은 표현으로 근거 수준을 표시한다.',
    '장시작 기업 공시는 disclosureNewsCandidates에서 실적, 유상증자, 무상증자, 계약, 자사주, 배당, M&A 관련 뉴스를 추출해 작성한다.',
    '장시작 주요 일정은 scheduleNewsCandidates에서 신규상장, 청약, 보호예수, 주총, 경제지표, 거래정지/변경상장 일정을 추출해 작성한다.',
    '장마감 업종별/테마별 흐름은 sectorThemeNewsCandidates와 marketNews에서 강세/약세 업종과 테마를 반드시 분리해 작성한다.',
    '장시작/장마감의 수급, 공시, 일정, 업종/테마 섹션에서 "확인 필요", "없음", "데이터 부족", "수집 실패" 같은 회피 문구는 금지한다.',
    '장마감 주요 특징주는 stockNewsCandidates에서 뉴스 제목/요약에 직접 언급된 종목만 사용한다.',
    '장마감 notableStocks.surging과 notableStocks.plunging은 각각 최소 2개 이상 작성한다.',
    '등락률은 뉴스 제목/요약에 수치가 있을 때만 쓰고, 없으면 등락률 없이 상승/하락 사유만 쓴다.',
    '주요 특징주 섹션에서 "확인 필요", "없음", "데이터 부족" 같은 회피 문구는 금지한다.',
    '투자 권유, 매수/매도 지시, 확정적 수익 표현은 금지한다.',
    '사용자에게 노출되는 문장은 한국어 존댓말로 작성한다.',
    `아래 ${config.sessionLabel} 전용 섹션 구조와 라벨을 유지한다.`,
    '반드시 JSON만 출력한다. 마크다운, 코드펜스, 설명 문장을 붙이지 않는다.',
    '',
    '출력 스키마:',
    JSON.stringify(reportSchema(), null, 2),
    '',
    '입력 데이터:',
    JSON.stringify(marketResearch, null, 2)
  ].join('\n');
}

function normalizeMarketResearch(raw, apiPayload = {}) {
  const citations = Array.isArray(apiPayload?.citations) ? apiPayload.citations : [];
  const searchResults = Array.isArray(apiPayload?.search_results) ? apiPayload.search_results : [];
  const sources = Array.isArray(raw.sources) && raw.sources.length > 0
    ? raw.sources
    : searchResults.map((item) => ({ title: item.title ?? item.url, url: item.url, date: item.date ?? item.last_updated ?? null }));

  return {
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
    phase: raw.phase ?? PHASE,
    sessionLabel: raw.sessionLabel ?? PHASE_CONFIG[PHASE].sessionLabel,
    summary: raw.summary ?? { signal: 'yellow', totalScore: 0, delayed: true, guide: '공개 무키 데이터 소스 기준으로 시장 상황을 점검합니다.' },
    indicators: Array.isArray(raw.indicators) ? raw.indicators : [],
    majorIndices: Array.isArray(raw.majorIndices) ? raw.majorIndices : [],
    marketNews: Array.isArray(raw.marketNews) ? raw.marketNews : [],
    stockNewsCandidates: Array.isArray(raw.stockNewsCandidates) ? raw.stockNewsCandidates : [],
    investorFlowNewsCandidates: Array.isArray(raw.investorFlowNewsCandidates) ? raw.investorFlowNewsCandidates : [],
    disclosureNewsCandidates: Array.isArray(raw.disclosureNewsCandidates) ? raw.disclosureNewsCandidates : [],
    scheduleNewsCandidates: Array.isArray(raw.scheduleNewsCandidates) ? raw.scheduleNewsCandidates : [],
    sectorThemeNewsCandidates: Array.isArray(raw.sectorThemeNewsCandidates) ? raw.sectorThemeNewsCandidates : [],
    investorFlows: raw.investorFlows ?? { status: 'unavailable', reason: 'not_collected' },
    sourceStatus: raw.sourceStatus ?? {},
    dataQuality: raw.dataQuality ?? '공개 무키 데이터 소스 기반으로 생성되었습니다. unavailable 항목은 추정하지 않습니다.',
    sources,
    citations,
    searchResults
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'market-briefing-report/1.0'
    }
  });
  const body = await res.text();
  if (!res.ok) {
    const error = new Error(`fetch_failed_${res.status}`);
    error.status = res.status;
    error.body = body.slice(0, 500);
    throw error;
  }
  return JSON.parse(body);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/rss+xml,text/xml,text/html,*/*',
      'user-agent': 'market-briefing-report/1.0'
    }
  });
  const body = await res.text();
  if (!res.ok) {
    const error = new Error(`fetch_failed_${res.status}`);
    error.status = res.status;
    error.body = body.slice(0, 500);
    throw error;
  }
  return body;
}

function decodeXml(value) {
  return String(value ?? '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'");
}

function stripHtml(value) {
  return decodeXml(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatChange(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, digits)}`;
}

function trendFromChange(value) {
  if (!Number.isFinite(value)) return 'unknown';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

function signalFromChangePercent(value) {
  if (!Number.isFinite(value)) return 'yellow';
  if (value > 0.2) return 'blue';
  if (value < -0.2) return 'red';
  return 'yellow';
}

function summarizeNewsCandidates(items, limit = 4) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items
    .slice(0, limit)
    .map((item) => `${item.title}${item.source ? ` (${item.source})` : ''}`)
    .join(' / ');
}

async function fetchYahooIndex({ key, title, symbol }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const json = await fetchJson(url);
  const result = json?.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes = Array.isArray(quote.close) ? quote.close.filter(Number.isFinite) : [];
  const current = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes.at(-1);
  const previous = Number.isFinite(meta.previousClose) ? meta.previousClose : closes.at(-2);
  const change = Number.isFinite(meta.regularMarketChange) ? meta.regularMarketChange : current - previous;
  const changePercent = Number.isFinite(meta.regularMarketChangePercent)
    ? meta.regularMarketChangePercent
    : previous ? (change / previous) * 100 : null;

  return {
    key,
    title,
    currentPrice: formatNumber(current, key === 'usdkrw' ? 2 : 2),
    change: formatChange(change),
    changePercent: Number.isFinite(changePercent) ? `${formatChange(changePercent)}%` : null,
    trend: trendFromChange(change),
    status: Number.isFinite(current) ? 'delayed' : 'unavailable',
    updatedAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`
  };
}

function parseGoogleNewsRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = match[1];
    const title = stripHtml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    const link = decodeXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const source = stripHtml(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]);
    const publishedAt = stripHtml(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]);
    const summary = stripHtml(item.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
    return { title, summary, source, publishedAt, sourceUrl: link };
  }).filter((item) => item.title && item.sourceUrl);
}

async function fetchGoogleNews(queries = NEWS_QUERIES, limit = 10) {
  const collected = [];
  for (const query of queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    try {
      const items = parseGoogleNewsRss(await fetchText(url)).map((item) => ({ ...item, query }));
      collected.push(...items);
    } catch (error) {
      collected.push({
        title: `${query} 뉴스 수집 실패`,
        summary: error.message,
        source: 'Google News RSS',
        publishedAt: null,
        sourceUrl: url,
        status: 'unavailable'
      });
    }
  }

  const seen = new Set();
  return collected.filter((item) => {
    const key = item.sourceUrl || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

async function fetchNewsCandidateGroup(queries, limit, statusKey, sourceStatus) {
  try {
    const items = await fetchGoogleNews(queries, limit);
    sourceStatus[statusKey] = items.some((item) => item.status === 'unavailable') ? 'partial' : 'ok';
    return items;
  } catch (error) {
    sourceStatus[statusKey] = `unavailable:${error.message}`;
    return [];
  }
}

function unavailableInvestorFlows(reason) {
  return {
    status: 'unavailable',
    generatedAt: new Date().toISOString(),
    source: 'pykrx/KRX',
    reason,
    markets: []
  };
}

async function fetchInvestorFlows() {
  if (process.env.INVESTOR_FLOW_DISABLED === '1') {
    return unavailableInvestorFlows('disabled_by_env');
  }

  try {
    const { stdout } = await execFileAsync(
      process.env.PYTHON_BIN ?? 'python3',
      ['scripts/fetch_investor_flows.py'],
      {
        timeout: INVESTOR_FLOW_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      }
    );
    const parsed = JSON.parse(stdout);
    return parsed?.status ? parsed : unavailableInvestorFlows('invalid_pykrx_payload');
  } catch (error) {
    const stderr = error?.stderr ? ` ${String(error.stderr).slice(0, 500)}` : '';
    return unavailableInvestorFlows(`${error?.message ?? 'pykrx_failed'}${stderr}`.trim());
  }
}

function isInvestorFlowsAvailable(investorFlows) {
  return ['ok', 'partial'].includes(investorFlows?.status) && Array.isArray(investorFlows.markets) && investorFlows.markets.length > 0;
}

function formatFlowAmount(value) {
  if (!Number.isFinite(value)) return null;
  const absEok = Math.abs(value) / 100000000;
  const formatted = new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: absEok >= 100 ? 0 : 1
  }).format(absEok);
  return `${value >= 0 ? '순매수' : '순매도'} ${formatted}억원`;
}

function summarizeInvestorFlows(investorFlows) {
  if (!isInvestorFlowsAvailable(investorFlows)) return null;

  const summaries = investorFlows.markets.map((market) => {
    const foreign = formatFlowAmount(market?.netBuy?.foreign);
    const institution = formatFlowAmount(market?.netBuy?.institution);
    const retail = formatFlowAmount(market?.netBuy?.retail);
    return `${market.market} ${market.latestDate}: 외국인 ${foreign ?? '확인 불가'}, 기관 ${institution ?? '확인 불가'}, 개인 ${retail ?? '확인 불가'}`;
  });

  return summaries.join(' / ');
}

async function collectPublicMarketResearch() {
  const indices = [];
  const sourceStatus = {};

  for (const item of YAHOO_SYMBOLS) {
    try {
      indices.push(await fetchYahooIndex(item));
      sourceStatus[`yahoo:${item.key}`] = 'ok';
    } catch (error) {
      indices.push({
        key: item.key,
        title: item.title,
        currentPrice: null,
        change: null,
        changePercent: null,
        trend: 'unknown',
        status: 'unavailable',
        updatedAt: null,
        sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(item.symbol)}`
      });
      sourceStatus[`yahoo:${item.key}`] = `unavailable:${error.message}`;
    }
  }

  const marketNews = await fetchNewsCandidateGroup(NEWS_QUERIES, 10, 'googleNews', sourceStatus);
  const stockNewsCandidates = await fetchNewsCandidateGroup(NOTABLE_STOCK_QUERIES, 18, 'stockNewsCandidates', sourceStatus);
  const investorFlowNewsCandidates = await fetchNewsCandidateGroup(INVESTOR_FLOW_NEWS_QUERIES, 12, 'investorFlowNewsCandidates', sourceStatus);
  const disclosureNewsCandidates = await fetchNewsCandidateGroup(DISCLOSURE_NEWS_QUERIES, 12, 'disclosureNewsCandidates', sourceStatus);
  const scheduleNewsCandidates = await fetchNewsCandidateGroup(MARKET_SCHEDULE_QUERIES, 12, 'scheduleNewsCandidates', sourceStatus);
  const sectorThemeNewsCandidates = await fetchNewsCandidateGroup(SECTOR_THEME_QUERIES, 14, 'sectorThemeNewsCandidates', sourceStatus);

  const investorFlows = await fetchInvestorFlows();
  sourceStatus.investorFlows = isInvestorFlowsAvailable(investorFlows)
    ? investorFlows.status
    : `unavailable:${investorFlows.reason ?? 'unknown'}`;
  const investorFlowSummary = summarizeInvestorFlows(investorFlows);

  const indicators = indices.map((item) => ({
    key: item.key,
    title: item.title,
    value: item.currentPrice,
    change: item.changePercent,
    signal: signalFromChangePercent(Number.parseFloat(item.changePercent)),
    status: item.status,
    updatedAt: item.updatedAt,
    reason: item.status === 'unavailable' ? '공개 무키 소스에서 확인하지 못했습니다.' : `${item.title} 공개 지연 시세입니다.`,
    sourceUrl: item.sourceUrl
  }));

  indicators.push(
    {
      key: 'investor_flow',
      title: '투자자별 수급',
      value: investorFlowSummary,
      change: null,
      signal: 'yellow',
      status: isInvestorFlowsAvailable(investorFlows) ? 'delayed' : 'unavailable',
      updatedAt: investorFlows.generatedAt ?? null,
      reason: isInvestorFlowsAvailable(investorFlows)
        ? 'pykrx를 통해 KRX 투자자별 순매수 거래대금을 수집했습니다. 장시작 브리핑에서는 최신 완료 거래일 기준으로 해석합니다.'
        : `pykrx/KRX 정형 수급은 수집되지 않았고, investorFlowNewsCandidates 뉴스 후보를 보조 근거로 사용합니다: ${summarizeNewsCandidates(investorFlowNewsCandidates, 3) ?? investorFlows.reason ?? 'unknown'}`,
      sourceUrl: 'https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd'
    },
    {
      key: 'disclosures',
      title: '공시',
      value: summarizeNewsCandidates(disclosureNewsCandidates, 4),
      change: null,
      signal: 'yellow',
      status: disclosureNewsCandidates.length > 0 ? 'news_based' : 'unavailable',
      updatedAt: new Date().toISOString(),
      reason: disclosureNewsCandidates.length > 0
        ? 'Google News RSS 공시 전용 후보를 보조 근거로 사용합니다.'
        : '공시 전용 뉴스 후보를 수집하지 못했습니다.',
      sourceUrl: 'https://news.google.com/rss'
    }
  );

  return normalizeMarketResearch({
    generatedAt: new Date().toISOString(),
    phase: PHASE,
    sessionLabel: PHASE_CONFIG[PHASE].sessionLabel,
    summary: {
      signal: 'yellow',
      totalScore: 0,
      delayed: true,
      guide: 'Yahoo Finance 공개 지연 시세와 Google News RSS를 기준으로 작성합니다. unavailable 항목은 확인 필요로 표기합니다.'
    },
    indicators,
    majorIndices: indices,
    marketNews,
    stockNewsCandidates,
    investorFlowNewsCandidates,
    disclosureNewsCandidates,
    scheduleNewsCandidates,
    sectorThemeNewsCandidates,
    investorFlows,
    dataQuality: isInvestorFlowsAvailable(investorFlows)
      ? '공개 데이터 소스 기반입니다. 지수는 지연 시세일 수 있고, 투자자별 수급은 pykrx/KRX 최신 완료 거래일 기준입니다. 공시/일정/업종테마/특징주는 전용 뉴스 후보를 보조 근거로 사용합니다.'
      : '공개 데이터 소스 기반입니다. 지수는 지연 시세일 수 있고, 정형 수급 실패 시 투자자 수급 뉴스 후보를 보조 근거로 사용합니다. 공시/일정/업종테마/특징주는 전용 뉴스 후보를 근거로 작성합니다.',
    sourceStatus,
    sources: [
      { title: 'Yahoo Finance chart API', url: 'https://query1.finance.yahoo.com/v8/finance/chart/', date: null },
      { title: 'Google News RSS', url: 'https://news.google.com/rss', date: null },
      { title: 'KRX investor trading value via pykrx', url: 'https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd', date: null }
    ],
    citations: [],
    searchResults: []
  });
}

function mockMarketResearch() {
  return {
    generatedAt: new Date().toISOString(),
    phase: PHASE,
    sessionLabel: PHASE_CONFIG[PHASE].sessionLabel,
    summary: {
      signal: 'yellow',
      totalScore: 6,
      delayed: false,
      guide: '목업 데이터 기준으로 변동성 구간을 점검합니다.'
    },
    indicators: [
      {
        key: 'nasdaq_futures',
        title: '나스닥 선물',
        value: '-0.35%',
        change: '-0.35%',
        signal: 'yellow',
        status: 'live',
        updatedAt: 'mock',
        reason: '미국 성장주 선행 심리가 약해졌습니다.',
        sourceUrl: 'https://example.com/nasdaq-futures'
      },
      {
        key: 'vix',
        title: 'VIX',
        value: '18.2',
        change: '+0.8',
        signal: 'yellow',
        status: 'live',
        updatedAt: 'mock',
        reason: '변동성 지표가 경계권에 있습니다.',
        sourceUrl: 'https://example.com/vix'
      }
    ],
    majorIndices: [
      { key: 'kospi', title: 'KOSPI', currentPrice: '2,745.12', change: '-8.20', changePercent: '-0.30%', trend: 'down', status: 'live', updatedAt: 'mock', sourceUrl: 'https://example.com/kospi' },
      { key: 'kosdaq', title: 'KOSDAQ', currentPrice: '852.44', change: '+2.10', changePercent: '+0.25%', trend: 'up', status: 'live', updatedAt: 'mock', sourceUrl: 'https://example.com/kosdaq' }
    ],
    marketNews: [
      { title: '반도체 대형주 변동성 확대', summary: '외국인 수급과 미국 기술주 흐름을 함께 확인할 필요가 있습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/news-1' },
      { title: '원/달러 환율 경계감 지속', summary: '환율 흐름이 외국인 수급의 주요 변수로 남아 있습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/news-2' },
      { title: '미국 기술주 선물 약세', summary: '국내 성장주 투자심리에 부담을 줄 수 있습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/news-3' },
      { title: '2차전지 업종 변동성 확대', summary: '테마 내 종목별 차별화가 필요합니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/news-4' },
      { title: '기관 수급 업종별 편차', summary: '대형주와 중소형주의 체감 흐름이 다를 수 있습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/news-5' }
    ],
    stockNewsCandidates: [
      { title: '삼성전자, 반도체 업황 기대에 상승', summary: '메모리 가격 회복 기대와 외국인 매수세가 부각됐습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/stock-1', query: 'mock 특징주' },
      { title: 'SK하이닉스, AI 반도체 수요 기대에 강세', summary: 'AI 서버 투자 확대 기대가 반영됐습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/stock-2', query: 'mock 특징주' },
      { title: 'HDC현대산업개발, 부동산 PF 우려에 약세', summary: '건설 업종 투자심리가 위축됐습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/stock-3', query: 'mock 특징주' },
      { title: '한화시스템, 우주항공 테마 차익실현에 하락', summary: '테마 과열 부담으로 매물이 출회됐습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/stock-4', query: 'mock 특징주' }
    ],
    investorFlowNewsCandidates: [
      { title: '외국인, 반도체 대형주 중심 순매수 지속', summary: '기관은 금융투자 중심으로 차익 실현 매물이 나왔습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/flow-1', query: 'mock 수급' },
      { title: '연기금, 코스피 대형주 매수 전환 여부 주목', summary: '선물 시장 외국인 포지션 변화가 장중 변수로 거론됐습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/flow-2', query: 'mock 수급' }
    ],
    disclosureNewsCandidates: [
      { title: 'A사, 대규모 공급계약 체결 공시', summary: '전일 장 마감 후 수주 공시가 확인됐습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/disclosure-1', query: 'mock 공시' },
      { title: 'B사, 자사주 취득 결정', summary: '주주환원 정책 강화 공시가 부각됐습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/disclosure-2', query: 'mock 공시' }
    ],
    scheduleNewsCandidates: [
      { title: '오늘 신규상장 및 보호예수 해제 일정', summary: '신규 상장주와 일부 보호예수 해제 물량이 예정돼 있습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/schedule-1', query: 'mock 일정' },
      { title: '미국 경제지표 발표 앞두고 관망세', summary: '장 시작 전 해외 지표 확인이 필요합니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/schedule-2', query: 'mock 일정' }
    ],
    sectorThemeNewsCandidates: [
      { title: '반도체 업종 강세, 메모리 가격 반등 기대', summary: '대형 반도체주가 지수 방어를 주도했습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/theme-1', query: 'mock 업종' },
      { title: '건설 업종 약세, 부동산 PF 우려 부각', summary: '금리 부담과 부실채권 우려가 투자심리를 제한했습니다.', source: 'Mock News', publishedAt: 'mock', sourceUrl: 'https://example.com/theme-2', query: 'mock 업종' }
    ],
    dataQuality: 'mock 데이터입니다.',
    sources: [{ title: 'Mock market source', url: 'https://example.com/news', date: null }],
    citations: [],
    searchResults: []
  };
}

function buildBriefingChatRequest(prompt, model = ANALYST_MODEL, options = {}) {
  const request = {
    model,
    messages: [
      {
        role: 'system',
        content: 'Return only valid JSON. Use only provided data. Do not provide investment advice.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.35
  };
  if (options.disableThinking) {
    request.thinking = { type: 'disabled' };
  }
  return request;
}

function buildOpenCodeZenBriefingRequest(prompt, model = ANALYST_MODEL) {
  return buildBriefingChatRequest(prompt, model, { disableThinking: true });
}

async function callOpenCodeZen(prompt, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENCODE_ZEN_API_KEY;
  if (!apiKey) throw new Error('missing_opencode_zen_api_key');

  const res = await fetch(`${OPENCODE_ZEN_BASE_URL}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(buildOpenCodeZenBriefingRequest(prompt, options.model ?? ANALYST_MODEL))
  });

  const body = await res.text();
  if (!res.ok) {
    const error = new Error(`opencode_zen_failed_${res.status}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }

  const json = JSON.parse(body);
  return validateReportShape(extractJson(json?.choices?.[0]?.message?.content ?? ''));
}

async function callOpenRouter(prompt, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('missing_openrouter_api_key');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'http-referer': process.env.OPENROUTER_SITE_URL ?? 'https://thirdtype-dev.github.io',
      'x-title': process.env.OPENROUTER_APP_TITLE ?? 'Maedo Signal Market Briefing'
    },
    body: JSON.stringify(buildBriefingChatRequest(prompt, options.model ?? ANALYST_MODEL))
  });

  const body = await res.text();
  if (!res.ok) {
    const error = new Error(`openrouter_failed_${res.status}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }

  const json = JSON.parse(body);
  return validateReportShape(extractJson(json?.choices?.[0]?.message?.content ?? ''));
}

async function callPrimaryWriter(prompt) {
  if (ANALYST_PROVIDER === 'opencode-zen') return callOpenCodeZen(prompt);
  if (ANALYST_PROVIDER === 'openrouter') return callOpenRouter(prompt);
  throw new Error(`unsupported_analyst_provider_${ANALYST_PROVIDER}`);
}

function getFallbackOpenRouterApiKey() {
  return process.env.OPENROUTER_FALLBACK_API_KEY ?? process.env.OPENROUTER_API_KEY;
}

async function callOpenRouterFallback(prompt) {
  const apiKey = getFallbackOpenRouterApiKey();
  if (!apiKey) throw new Error('missing_openrouter_fallback_api_key');
  return callOpenRouter(prompt, {
    apiKey,
    model: FALLBACK_MODEL
  });
}

function mockReport(marketResearch) {
  if (PHASE === 'post_market') {
    return {
      marketSummary: {
        kospi: '2,745.12 (▼ 0.30%)',
        kosdaq: '852.44 (▲ 0.25%)',
        summary: '미국 기술주 선물 약세에도 반도체 대형주 수급이 지수를 방어했고, 코스닥은 일부 성장주 반등으로 상대적으로 견조했습니다.'
      },
      investorFlows: {
        foreign: '순매수 우위. 반도체와 자동차 대형주 중심으로 매수세가 유입됐습니다.',
        institution: '프로그램 매매 영향으로 업종별 편차가 컸고, 금융과 배당주는 일부 차익 실현이 확인됐습니다.',
        retail: '코스닥 중소형 테마주와 2차전지 반등 구간에서 단기 매매 비중이 높았습니다.'
      },
      sectorThemes: {
        strong: '반도체 - 메모리 가격 반등 기대와 대형주 실적 개선 기대가 동시에 반영됐습니다.',
        weak: '건설/부동산 - 금리 부담과 부실 채권 우려가 투자심리를 제한했습니다.'
      },
      notableStocks: {
        surging: [
          '삼성전자, +1.8%, 외국인 순매수와 메모리 업황 개선 기대',
          '에코프로비엠, +3.2%, 2차전지 소재주 반등 흐름'
        ],
        plunging: [
          'HDC현대산업개발, -2.4%, 부동산 PF 우려 재부각',
          '한화시스템, -1.9%, 우주/방산 테마 차익 실현'
        ]
      },
      tomorrowStrategy: {
        outlook: '지수는 박스권 상단 확인 구간이며, 주도 업종의 거래대금 유지 여부가 다음 거래일 방향성을 가를 가능성이 큽니다.',
        checklist: [
          '미국 나스닥 선물과 필라델피아 반도체 지수 흐름',
          '원/달러 환율의 1차 저항선 돌파 여부',
          '외국인 선물 포지션과 프로그램 매매 방향'
        ]
      }
    };
  }

  return {
    openingStrategy: {
      keywords: '반도체 실적 랠리, 원/달러 환율 경계, 2차전지 반등 시도',
      oneLineStrategy: '지수 추격보다 장 초반 거래대금이 붙는 주도 업종 중심으로 눌림목 대응이 유리합니다.',
      expectedOpen: '전일 미국 기술주 혼조와 환율 부담을 함께 반영해 강보합 출발 후 업종별 차별화가 예상됩니다.'
    },
    investorFlowWatch: {
      continuity: '외국인의 반도체 업종 3거래일 연속 매수세가 유지되는지 확인합니다.',
      keyInvestor: '최근 매도세를 보였던 연기금이 대형주로 복귀하는지 주목합니다.',
      checkPoint: '선물 시장의 외국인 포지션 변화와 프로그램 매매 순매수 전환 여부를 함께 봅니다.'
    },
    sectorWeather: {
      sunny: '이차전지 - 전일 테슬라 반등과 리튬 가격 안정 기대가 투자심리를 보완합니다.',
      cloudy: '은행/금융 - 금리 변동성 확대 속 배당 매력과 차익 실현 압력이 공존합니다.',
      rainy: '건설/부동산 - 부실 채권 우려와 금리 부담이 이어져 방어적 접근이 필요합니다.'
    },
    disclosuresAndNews: {
      corporateDisclosure: '전일 장 마감 후 반도체 부품주의 실적 가이던스 상향 공시가 확인됐습니다.',
      majorNews: '정부의 첨단산업 세제 지원 확대 논의가 반도체와 배터리 밸류체인에 영향을 줄 수 있습니다.',
      schedule: '금일 신규 상장 종목과 일부 바이오주의 보호예수 해제 물량을 확인해야 합니다.'
    },
    watchlist: {
      leaders: '삼성전자, SK하이닉스 - 반도체 대형주 수급 연속성 확인 대상',
      technicals: 'LG에너지솔루션 - 단기 이동평균선 회복 여부와 거래대금 증가 여부 확인',
      eventDriven: '전일 공시 및 정책 뉴스에 노출된 반도체 소재주 중심으로 변동성 확대 가능성'
    }
  };
}

async function writeReportWithFallback(marketResearch) {
  if (process.env.REPORT_LLM_MOCK === '1') {
    return { report: mockReport(marketResearch), writer: { provider: 'mock', model: 'mock', fallbackReason: null } };
  }

  const prompt = buildPrompt(marketResearch);
  try {
    return {
      report: await withLlmRetry(ANALYST_PROVIDER, () => callPrimaryWriter(prompt)),
      writer: { provider: ANALYST_PROVIDER, model: ANALYST_MODEL, fallbackReason: null }
    };
  } catch (error) {
    const fallbackReason = isQuotaError(error) ? 'primary_quota_exceeded' : 'primary_failed';
    console.warn('[market-briefing] primary writer failed; retrying fallback', {
      provider: ANALYST_PROVIDER,
      model: ANALYST_MODEL,
      reason: fallbackReason,
      error: error.message
    });

    return {
      report: await withLlmRetry('openrouter-fallback', () => callOpenRouterFallback(prompt)),
      writer: { provider: FALLBACK_PROVIDER, model: FALLBACK_MODEL, fallbackReason }
    };
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function labeledList(entries) {
  return `<ul class="brief-list">${entries.map(([label, value]) => `<li><span class="item-label">${escapeHtml(label)}</span><span class="item-value">${escapeHtml(value ?? '')}</span></li>`).join('')}</ul>`;
}

function dateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function renderArticle(report) {
  const config = PHASE_CONFIG[PHASE];
  const body = PHASE === 'post_market' ? renderPostMarketReport(report) : renderPreMarketReport(report);
  const articleClass = PHASE === 'post_market' ? 'report-post-market' : 'report-pre-market';

  return `<article class="report ${articleClass}">
      <div class="eyebrow published">${escapeHtml(config.eyebrow)}</div>
      <h1>${escapeHtml(dateKey())} ${escapeHtml(config.sessionLabel)}</h1>
${body}
    </article>`;
}

function renderPreMarketReport(report) {
  return `<h2>① 오늘의 증시 키워드 &amp; 개장 전략</h2>
${labeledList([
  ['핵심 키워드', report.openingStrategy?.keywords],
  ['한줄 전략', report.openingStrategy?.oneLineStrategy],
  ['개장 예상', report.openingStrategy?.expectedOpen]
])}
<h2>② 외국인/기관 수급 관전 포인트</h2>
${labeledList([
  ['수급 연속성 체크', report.investorFlowWatch?.continuity],
  ['관심 주체', report.investorFlowWatch?.keyInvestor],
  ['체크 사항', report.investorFlowWatch?.checkPoint]
])}
<h2>③ 주요 업종별 기상도 (강세/약세 예보)</h2>
${labeledList([
  ['☀️ 강세 예보', report.sectorWeather?.sunny],
  ['☁️ 중립 예보', report.sectorWeather?.cloudy],
  ['☔ 약세 예보', report.sectorWeather?.rainy]
])}
<h2>④ 당일 핵심 공시 및 뉴스 요약</h2>
${labeledList([
  ['기업 공시', report.disclosuresAndNews?.corporateDisclosure],
  ['주요 뉴스', report.disclosuresAndNews?.majorNews],
  ['주요 일정', report.disclosuresAndNews?.schedule]
])}
<h2>⑤ 금일의 전략 종목 (Watchlist)</h2>
${labeledList([
  ['주도주 후보', report.watchlist?.leaders],
  ['기술적 관심주', report.watchlist?.technicals],
  ['이슈 종목', report.watchlist?.eventDriven]
])}`;
}

function renderPostMarketReport(report) {
  const surging = Array.isArray(report.notableStocks?.surging) && report.notableStocks.surging.length > 0
    ? report.notableStocks.surging.join(' / ')
    : '특징주 뉴스 후보에서 상승 종목을 재분류해야 합니다.';
  const plunging = Array.isArray(report.notableStocks?.plunging) && report.notableStocks.plunging.length > 0
    ? report.notableStocks.plunging.join(' / ')
    : '특징주 뉴스 후보에서 하락 종목을 재분류해야 합니다.';

  return `<h2>① 시장 총평</h2>
${labeledList([
  ['KOSPI', report.marketSummary?.kospi],
  ['KOSDAQ', report.marketSummary?.kosdaq],
  ['요약', report.marketSummary?.summary]
])}
<h2>② 투자자별 수급 동향</h2>
${labeledList([
  ['외국인', report.investorFlows?.foreign],
  ['기관', report.investorFlows?.institution],
  ['개인', report.investorFlows?.retail]
])}
<h2>③ 업종별/테마별 흐름</h2>
${labeledList([
  ['✅ 강세 업종', report.sectorThemes?.strong],
  ['❌ 약세 업종', report.sectorThemes?.weak]
])}
<h2>④ 주요 특징주</h2>
${labeledList([
  ['급등 종목', surging],
  ['급락 종목', plunging]
])}
<h2>⑤ 내일의 투자 전략</h2>
${labeledList([
  ['시장 전망', report.tomorrowStrategy?.outlook],
  ['체크리스트', (report.tomorrowStrategy?.checklist ?? []).join(' / ')]
])}`;
}

function renderRoomScript() {
  return `<script>
    (() => {
      const READING_ROOM_PASSWORD = '1710';
      const READING_ROOM_AUTH_KEY = 'reading-room-auth';
      const params = new URLSearchParams(window.location.search);
      const isAppEntry = params.get('maedo_app') === '1'
        || params.get('source') === 'maedo-signal'
        || /\\bwv\\b|MaedoSignal|maedo-signal|com\\.maedo\\.signal/iu.test(window.navigator.userAgent);

      if (isAppEntry) {
        sessionStorage.setItem(READING_ROOM_AUTH_KEY, 'app');
        if (params.has('maedo_app') || params.has('source')) {
          params.delete('maedo_app');
          params.delete('source');
          const query = params.toString();
          window.history.replaceState(null, '', \`\${window.location.pathname}\${query ? \`?\${query}\` : ''}\${window.location.hash}\`);
        }
      } else if (sessionStorage.getItem(READING_ROOM_AUTH_KEY) !== 'ok') {
        const input = window.prompt('리딩방 비밀번호를 입력하세요');
        if (input === READING_ROOM_PASSWORD) {
          sessionStorage.setItem(READING_ROOM_AUTH_KEY, 'ok');
        } else {
          document.body.innerHTML = '<main class="page"><article class="report"><div class="eyebrow published">리딩방</div><h1>접근이 제한되었습니다</h1><p>비밀번호 확인 후 다시 접속해 주세요.</p></article></main>';
          return;
        }
      }

      const tabs = document.querySelectorAll('[data-room-tab]');
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const href = tab.getAttribute('data-room-link');
          if (href) window.location.href = href;
        });
      });
    })();
  </script>`;
}

function decorateArticlePhase(article) {
  if (article.includes('report-pre-market') || article.includes('report-post-market')) return article;
  if (article.includes('장마감') || article.includes('장종료')) {
    return article.replace('<article class="report"', '<article class="report report-post-market"');
  }
  return article.replace('<article class="report"', '<article class="report report-pre-market"');
}

function shouldPreserveExistingReports() {
  return process.env.PRESERVE_EXISTING_REPORTS !== '0';
}

function extractArticles(html) {
  return html.match(ARTICLE_RE) ?? [];
}

async function readExistingOutputArticles() {
  try {
    return extractArticles(await readFile(resolve(OUTPUT_DIR, 'index.html'), 'utf-8'));
  } catch {
    return [];
  }
}

async function fetchPublishedArticles() {
  if (process.env.REPORT_LLM_MOCK === '1' && process.env.PRESERVE_EXISTING_REPORTS !== '1') return [];

  try {
    const res = await fetch(PUBLIC_REPORT_URL, {
      headers: {
        'user-agent': 'market-briefing-report/1.0'
      }
    });
    if (!res.ok) return [];
    return extractArticles(await res.text());
  } catch {
    return [];
  }
}

async function legacyArticles(currentArticle) {
  if (!shouldPreserveExistingReports()) return [];

  const config = PHASE_CONFIG[PHASE];
  const currentMarkers = [
    `<div class="eyebrow published">${escapeHtml(config.eyebrow)}</div>`,
    `<h1>${escapeHtml(dateKey())} ${escapeHtml(config.sessionLabel)}</h1>`
  ];
  const articles = [
    ...(await readExistingOutputArticles()),
    ...(await fetchPublishedArticles())
  ];
  const seen = new Set([currentArticle]);

  return articles.filter((article) => {
    const isCurrentReport = currentMarkers.every((marker) => article.includes(marker));
    if (isCurrentReport || seen.has(article)) return false;
    seen.add(article);
    return true;
  });
}

async function renderHtml(_marketResearch, report, writer) {
  const publishedAt = new Date().toISOString();
  const currentArticle = renderArticle(report);
  const articles = [currentArticle, ...(await legacyArticles(currentArticle))]
    .slice(0, 2)
    .map(decorateArticlePhase)
    .join('\n');

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="google-adsense-account" content="${ADSENSE_CLIENT}" />
    <title>브리핑</title>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>
    <style>
${REPORT_STYLE}
    </style>
  </head>
  <body>
    <main class="page" data-published-at="${escapeHtml(publishedAt)}" data-writer-provider="${escapeHtml(writer.provider)}" data-writer-model="${escapeHtml(writer.model)}" data-fallback-reason="${escapeHtml(writer.fallbackReason ?? '')}">
      <section class="room-header">
        <h1 class="room-title">리딩방</h1>
        <div class="room-tabs" role="tablist" aria-label="리딩방 상단 탭">
          <button type="button" class="room-tab is-active" data-room-tab="briefing" aria-selected="true">브리핑</button>
          <button type="button" class="room-tab" data-room-tab="realtime" data-room-link="./realtime.html" aria-selected="false">실시간 급등</button>
        </div>
      </section>
      <section id="briefing-pane">
${articles}
      </section>
      <section class="disclaimer">본 서비스의 투자 정보는 단순 참고용이며, 종목 추천이나 투자 권유가 아닙니다. 최종적인 투자 결정과 그에 따른 책임은 투자자 본인에게 있음을 알려드립니다</section>
    </main>
    ${renderRoomScript()}
  </body>
</html>
`;
}

async function main() {
  const marketResearch = process.env.REPORT_LLM_MOCK === '1' ? mockMarketResearch() : await collectPublicMarketResearch();
  const { report, writer } = await writeReportWithFallback(marketResearch);

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(resolve(DATA_DIR, 'market-research.json'), JSON.stringify(marketResearch, null, 2), 'utf-8');
  await writeFile(resolve(DATA_DIR, 'report.json'), JSON.stringify({ report, writer }, null, 2), 'utf-8');
  await writeFile(resolve(OUTPUT_DIR, 'index.html'), await renderHtml(marketResearch, report, writer), 'utf-8');

  console.log('[market-briefing] report generated', {
    output: resolve(OUTPUT_DIR, 'index.html'),
    researchProvider: process.env.REPORT_LLM_MOCK === '1' ? 'mock' : 'public-no-key',
    researchModel: process.env.REPORT_LLM_MOCK === '1' ? 'mock' : 'yahoo-finance+google-news-rss',
    writer
  });
}

main().catch((error) => {
  console.error('[market-briefing] failed', error);
  process.exit(1);
});
