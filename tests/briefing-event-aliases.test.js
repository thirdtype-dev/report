const test=require('node:test');
const assert=require('node:assert/strict');
const bok='한국은행 기준금리 결정은 공식 원문과 발표 시각의 검증 전까지 수치와 진행 단계 판단을 보류합니다.';
const tariff='통상 정책의 공식 발표 내용과 적용 범위·절차를 확인하며 업종별 영향을 점검합니다.';
const bokClaims=['한은 기준금리 결정 결과가 발표될 예정입니다','한국은행 금리 결정 결과가 발표될 예정입니다','한은 금리 결정 발표 예정','금통위 금리 동결이 발표됐습니다','금융통화위원회의 정책금리 결정이 공개됩니다','한은은 금리를 인상했습니다','한국은행 기준금리 결과는 미정입니다'];
const tariffClaims=['미국의 새 관세가 발표될 예정입니다','USTR 관세 조치가 발표되었습니다','미국 관세 인상안이 발표됩니다','미국 관세 조치가 공개될 예정입니다','관세 발표를 앞두고 있습니다'];
const safe=['한국은행 예금 금리 결정 동향을 점검합니다','한은 대출금리 인하가 은행주에 미치는 영향','한국은행의 채권 금리 발표 예정','한은 기준금리 변화에 따른 은행주 영향을 점검합니다','한은 금리 결정의 공식 원문과 발표 시각을 확인합니다','미국 관세 관련 공식 발표 내용과 절차를 점검합니다','은행 예금 금리 발표 예정'];
test('entity, policy-rate event and stage tables cover actual aliases without censoring other rates',async()=>{
 const {finalizeEvidenceCopy,finalCopyIssues}=await import('../scripts/briefing-evidence-boundary.mjs');
 for(const phase of ['pre_market','post_market']) for(const informationAsOf of ['2026-11-26T08:30:00+09:00','2026-11-26T16:00:00+09:00']) {
  const options={phase,informationAsOf};
  for(const [texts,expected] of [[bokClaims,bok],[tariffClaims,tariff]]) for(const text of texts) {
   const input={summary:text};
   assert.ok(finalCopyIssues(input,{},options).length,text);
   const out=finalizeEvidenceCopy(input,{},options);
   assert.equal(out.summary,expected,text);
   assert.deepEqual(finalCopyIssues(out,{},options),[],text);
   assert.deepEqual(finalizeEvidenceCopy(out,{},options),out,text);
  }
  for(const text of [...safe,bok,tariff]) {
   assert.equal(finalizeEvidenceCopy({summary:text},{},options).summary,text);
   assert.deepEqual(finalCopyIssues({summary:text},{},options),[]);
  }
 }
 for(const text of [...bokClaims,...tariffClaims]) assert.deepEqual(finalCopyIssues(text),[]);
});


test('final contextual gate catches aliases reintroduced after preparation, while supported pre-cutoff tariff wording stays stable',async()=>{
 const {finalizeEvidenceCopy,finalCopyIssues}=await import('../scripts/briefing-evidence-boundary.mjs');
 const proof={officialEvents:[{topic:'tariff',sourceUrl:'https://ustr.gov/press-release',stage:'proposed',publishedAt:'2026-11-25T13:11:00Z'}]};
 const options={phase:'pre_market',informationAsOf:'2026-11-26T08:30:00+09:00'};
 const prepared=finalizeEvidenceCopy({watchlist:{eventDriven:[tariffClaims[0]]}},proof,options);
 assert.match(prepared.watchlist.eventDriven[0],/제안·의견수렴/);
 assert.deepEqual(finalCopyIssues(prepared,proof,options),[]);
 for(const text of [...bokClaims,...tariffClaims]) {
  const rewritten=structuredClone(prepared);rewritten.watchlist.eventDriven.push(text);
  assert.ok(finalCopyIssues(rewritten,proof,options).length,text);
 }
});
