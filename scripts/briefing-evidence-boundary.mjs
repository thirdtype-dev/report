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
  const day = String(cutoff ?? '').slice(0,10);
  const limit = Date.parse(cutoff);
  const records = research?.stockCloseEvidence ?? [];
  const mentioned = records.filter(row => typeof row.name === 'string' && text.includes(row.name));
  if (!mentioned.length || !Number.isFinite(limit)) return false;
  const percentages = [...text.matchAll(/[-+]?\d+(?:\.\d+)?%/gu)].map(m=>m[0]);
  return percentages.length === mentioned.length && mentioned.every(row => {
    try {
      const url = new URL(row.sourceUrl);
      return row.tradingDate === day && row.session === 'regular_close' && row.status === 'official_close'
        && url.protocol === 'https:' && ['data.krx.co.kr','data-dbg.krx.co.kr'].includes(url.hostname)
        && Number.isFinite(Date.parse(row.marketTime)) && Date.parse(row.marketTime) <= limit
        && row.marketTime.startsWith(day) && percentages.includes(`${row.changePercent}%`)
        && text.includes(`${row.name} ${row.changePercent}%`);
    } catch { return false; }
  });
}
export function finalizeEvidenceCopy(report, research, { phase, informationAsOf } = {}) {
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
    for (const field of ['surging','plunging']) {
      if (Array.isArray(next.notableStocks?.[field])) next.notableStocks[field] = next.notableStocks[field].map(text => {
        if (!/%|퍼센트/u.test(text) || hasStockCloseEvidence(text, research, informationAsOf)) return text;
        const names = text.split(',')[0];
        return /[%\d]/u.test(names) ? '개별 종목의 공시와 수급 변화를 점검합니다.' : `${names} - 종목별 공시와 수급 변화를 점검합니다.`;
      });
    }
    // Do not turn article percentages (including yesterday/intraday numbers)
    // into a close. The separately rendered structured index values are retained.
    for (const [section, field] of [['marketSummary','summary'],['tomorrowStrategy','outlook']]) {
      if (/%|퍼센트/u.test(next?.[section]?.[field] ?? '')) next[section][field] = '시장 지수는 위에 표시된 기준 시점의 수치로 확인하고, 업종별 수급과 다음 거래일 변동성을 점검합니다.';
    }
  }
  return next;
}
export function finalCopyIssues(report) {
  const text = JSON.stringify(report ?? {});
  return EDITORIAL.test(text) || FRAGMENT.test(text) ? ['unfinished_editorial_copy'] : [];
}
