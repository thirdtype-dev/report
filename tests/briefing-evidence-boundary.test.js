const test = require('node:test');
const assert = require('node:assert/strict');
const boundary = import('../scripts/briefing-evidence-boundary.mjs');
const cutoff='2026-11-26T08:30:00+09:00';
test('official policy timestamps and stages do not leak across the publication boundary', async()=>{
 const {finalizeEvidenceCopy,policyEvidence}=await boundary;
 const report={watchlist:{eventDriven:'미국 관세 인상안 발표 여부'}};
 const event={topic:'tariff',stage:'proposed',sourceUrl:'https://ustr.gov/official-release',publishedAt:cutoff};
 assert.match(finalizeEvidenceCopy(report,{officialEvents:[event]},{informationAsOf:cutoff}).watchlist.eventDriven,/제안·의견수렴/);
 for(const altered of [{publishedAt:'2026-11-26T08:30:01+09:00'},{publishedAt:null},{sourceUrl:'https://news.example/ustr'},{stage:'effective'},{stage:'effective',effectiveAt:'2026-11-27T00:00:00+09:00'}]) {
  const research={officialEvents:[{...event,...altered}]};
  assert.equal(policyEvidence(research,cutoff),null);
  assert.doesNotMatch(finalizeEvidenceCopy(report,research,{informationAsOf:cutoff}).watchlist.eventDriven,/발표 여부|예정|시행 확정/);
 }
 assert.equal(policyEvidence({officialEvents:[event]},'invalid'),null);
});
test('post-guard fragments and internal editorial instructions never reach rendered copy',async()=>{
 const {finalizeEvidenceCopy,finalCopyIssues}=await boundary;
 for(const value of ['반도체 급락에가 확인돼','국내 증시: 코스피 6% 급락에도 / 반도체: 반도체 급락에','방향성 혼조 - 지배 방향이 확정되지 않은 업종만 확인해야 합니다.']) {
  const r={openingStrategy:{oneLineStrategy:value}};
  assert.deepEqual(finalCopyIssues(r),['unfinished_editorial_copy']);
  const fixed=finalizeEvidenceCopy(r,{},{});
  assert.deepEqual(finalCopyIssues(fixed),[]);
  assert.deepEqual(finalizeEvidenceCopy(fixed,{},{}),fixed);
 }
});
test('intraday and previous-day percentages are not promoted into closing prose',async()=>{
 const {finalizeEvidenceCopy}=await boundary;
 for(const text of ['코스피 장중 -5.65%','전일 +6.32%','코스피 -6.16%로 마감']) {
  const r={marketSummary:{kospi:'4,697.51 (-6.16%)',summary:text},tomorrowStrategy:{outlook:text}};
  const fixed=finalizeEvidenceCopy(r,{},{phase:'post_market'});
  assert.equal(fixed.marketSummary.kospi,r.marketSummary.kospi);
  assert.doesNotMatch(fixed.marketSummary.summary,/%/);
  assert.doesNotMatch(fixed.tomorrowStrategy.outlook,/%/);
 }
});
test('individual stock closes cannot be replaced by grouped headline percentages or prior-day/intraday evidence',async()=>{
 const {finalizeEvidenceCopy}=await boundary;
 const time='2026-11-25T16:00:00+09:00';
 const rows=[['삼성전자',-9.87],['SK하이닉스',-11.05]].map(([name,changePercent])=>({name,changePercent,tradingDate:'2026-11-25',session:'regular_close',status:'official_close',marketTime:'2026-11-25T15:30:00+09:00',sourceUrl:'https://data.krx.co.kr/close'}));
 const report={notableStocks:{plunging:['삼성전자 -9.87%, SK하이닉스 -11.05%']}};
 assert.deepEqual(finalizeEvidenceCopy(report,{stockCloseEvidence:rows},{phase:'post_market',informationAsOf:time}),report);
 for(const research of [{},{stockCloseEvidence:rows.map(r=>({...r,tradingDate:'2026-11-24'}))},{stockCloseEvidence:rows.map(r=>({...r,session:'intraday'}))},{stockCloseEvidence:rows.map(r=>({...r,marketTime:'2026-11-25T16:01:00+09:00'}))}]) assert.doesNotMatch(finalizeEvidenceCopy(report,research,{phase:'post_market',informationAsOf:time}).notableStocks.plunging[0],/%/);
 assert.doesNotMatch(finalizeEvidenceCopy({notableStocks:{plunging:['삼성전자·SK하이닉스, 9%대 급락']}},{stockCloseEvidence:rows},{phase:'post_market',informationAsOf:time}).notableStocks.plunging[0],/%/);
});
test('the final public HTML validator also rejects post-guard editorial fragments',async()=>{
 const {validateBriefingHtml}=await import('../scripts/check-briefing-recovery.mjs');
 for(const text of ['반도체 급락에가 확인돼 장 초반 변동성을 점검합니다.','방향성 혼조 - 지배 방향이 확정되지 않은 업종만 확인해야 합니다.']) {
  const html=`<article class="report-pre-market" data-information-as-of="${cutoff}"><h1>2026-11-26 08:30</h1><p>${text}</p></article>`;
  assert.equal(validateBriefingHtml(html,'pre_market',new Date(cutoff)).reason,'unfinished_editorial_copy');
 }
});
