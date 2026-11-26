import { indexCloseRows, seoulTradingDate } from './briefing-index-close.mjs';
// This boundary runs AFTER all editorial/event guards. Headline snippets are
// context, never proof of an official close or the stage of a policy action.
const EDITORIAL = /지배 방향이 확정되지 않은 업종만|상위 하방·혼조 사건과 분리되는|상방·혼조 결론과 분리되는|하방·혼조 결론과 분리되는/u;
const FRAGMENT = /(?:급락|급등|하락|상승)에(?:가|도?(?:\s*\/|\s*$))|급락에도(?:\s*\/|\s*$)/u;
const TARIFF_STAGE = /관세/u;
const STAGE_CLAIM = /발표\s*(?:여부|예정|확정|했|됐)|시행|발효|부과|인상안|효력|조치안|의견수렴/u;
const NEUTRAL_POLICY = '통상 정책의 공식 발표 내용과 적용 범위·절차를 확인하며 업종별 영향을 점검합니다.';
export function policyEvidence(research, cutoff) {
  const limit = Date.parse(cutoff);
  if (!Number.isFinite(limit)) return null;
  return (research?.officialEvents ?? []).filter(event => {
    try {
      const url = new URL(event.sourceUrl);
      return event.topic === 'tariff' && url.protocol === 'https:' && url.hostname === 'ustr.gov'
        && !url.username && !url.password && ['proposed','effective'].includes(event.stage)
        && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(event.publishedAt ?? '')
        && Number.isFinite(Date.parse(event.publishedAt)) && Date.parse(event.publishedAt) <= limit
        && (event.stage !== 'effective' || (Number.isFinite(Date.parse(event.effectiveAt)) && Date.parse(event.effectiveAt) <= limit));
    } catch { return false; }
  }).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0] ?? null;
}
export function hasStockCloseEvidence(text, research, cutoff) {
  const day = seoulTradingDate(cutoff);
  const limit = Date.parse(cutoff);
  const records = research?.stockCloseEvidence ?? [];
  const mentioned = records.filter(row => typeof row.name === 'string' && text.includes(row.name));
  if (!mentioned.length || !Number.isFinite(limit) || new Set(mentioned.map(row=>row.name)).size!==mentioned.length
      || /%\s*대|퍼센트/u.test(text)) return false;
  const percentages = [...text.matchAll(/[-+]?\d+(?:\.\d+)?%/gu)];
  if (percentages.length !== mentioned.length) return false;
  return mentioned.every(row => {
    try {
      const url = new URL(row.sourceUrl);
      const marketTime = Date.parse(row.marketTime);
      const escaped = row.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = text.match(new RegExp(`${escaped}\\s+([+-]?)(\\d+(?:\\.\\d+)?)%([^,/]*)`, 'u'));
      if (!match || !Number.isFinite(row.changePercent)) return false;
      const down = /하락|급락|▼/u.test(match[3]);
      const up = /상승|급등|▲/u.test(match[3]);
      if (down && up || match[1]==='-' && up || match[1]==='+' && down) return false;
      const sign = match[1]==='-' || down ? -1 : match[1]==='+' || up ? 1 : 0;
      if (sign === 0 && Number(match[2]) !== 0) return false;
      return row.tradingDate === day && row.session === 'regular_close' && row.status === 'official_close'
        && url.protocol === 'https:' && !url.username && !url.password && ['data.krx.co.kr','data-dbg.krx.co.kr'].includes(url.hostname)
        && Number.isFinite(marketTime) && marketTime <= limit && seoulTradingDate(row.marketTime)===day
        && Number((sign*Number(match[2])).toFixed(2)) === Number(row.changePercent.toFixed(2));
    } catch { return false; }
  });
}
export function finalizeEvidenceCopy(report, research, { phase, informationAsOf, tradingDate } = {}) {
  const event = policyEvidence(research, informationAsOf);
  const walk = value => {
    if (typeof value === 'string') {
      if (EDITORIAL.test(value) || FRAGMENT.test(value)) return '장 초반 업종별 등락과 거래대금, 수급 변화를 함께 점검합니다.';
      if (TARIFF_STAGE.test(value) && STAGE_CLAIM.test(value)) {
        if (!event) return NEUTRAL_POLICY;
        return event.stage === 'proposed'
          ? 'USTR의 관세 조치안은 제안·의견수렴 단계이며 시행 확정과 구분해 적용 범위와 후속 절차를 점검합니다.'
          : '공식 발표와 효력 발생일이 확인된 관세 조치의 적용 범위와 업종별 영향을 점검합니다.';
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v)]));
    return value;
  };
  const next = walk(report);
  if (phase === 'post_market') {
    const rows = indexCloseRows(research, informationAsOf, tradingDate);
    const closingWalk = (value, path = '') => {
      if (typeof value === 'string') {
        // Keep existing fail-closed placeholder diagnostics; never wash them away.
        if (/(수집되지 않았습니다|뉴스 수집 실패|fetch_failed_\d+|재분류해야 합니다|확인되지 않았습니다|확인 불가|확인\s*필요)/u.test(value)) return value;
        if (path === 'marketSummary.kospi' || path === 'marketSummary.kosdaq') return rows[path.split('.')[1]];
        if (/%|퍼센트/u.test(value) && ((tradingDate && seoulTradingDate(informationAsOf)!==tradingDate) || !hasStockCloseEvidence(value, research, informationAsOf))) {
          return '종목별 공시와 수급 변화, 업종별 흐름을 점검합니다.';
        }
        return value;
      }
      if (Array.isArray(value)) return value.map((entry,i)=>closingWalk(entry, `${path}.${i}`));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,closingWalk(v,path ? `${path}.${k}` : k)]));
      return value;
    };
    const closed = closingWalk(next);
    return closed;
  }
  return next;
}
export function finalCopyIssues(report, research, options = {}) {
  const text = JSON.stringify(report ?? {});
  const issues = EDITORIAL.test(text) || FRAGMENT.test(text) ? ['unfinished_editorial_copy'] : [];
  if (options.phase === 'post_market' && JSON.stringify(finalizeEvidenceCopy(report, research, options)) !== text) issues.push('unbound_closing_copy');
  return issues;
}
