const test=require('node:test');
const assert=require('node:assert/strict');
const rows=require('./fixtures/krx-close-floor/20261126-indices.json');
const epoch=s=>Date.parse(s)/1000;
const cutoff='2026-11-26T16:00:00+09:00';
const expected={kospi:'4,711.21 (▲ 0.29%)',kosdaq:'655.71 (▲ 0.78%)'};
function atTime(row,time,date='2026-11-26') {
 const x=structuredClone(row);
 x.closeEvidence.quoteTime=epoch(`${date}T${time}+09:00`);
 x.updatedAt=new Date(x.closeEvidence.quoteTime*1000).toISOString();
 return x;
}
function onDate(row,day) {
 const x=structuredClone(row),delta=epoch(`${day}T00:00:00+09:00`)-epoch('2026-11-26T00:00:00+09:00');
 for(const key of ['sessionStart','sessionEnd','quoteTime','barTime','previousBarTime']) x.closeEvidence[key]+=delta;
 x.sourceDate=day;x.updatedAt=new Date(x.closeEvidence.quoteTime*1000).toISOString();return x;
}
test('captured production rows reject 15:00/15:20 quotes despite vendor 15:00 end and preserve actual quotes/math',async()=>{
 const {verifiedIndexClose,indexCloseRows,NO_CLOSE_VALUE}=await import('../scripts/briefing-index-close.mjs');
 for(const row of rows) {
  assert.equal(row.closeEvidence.sessionEnd,epoch('2026-11-26T15:00:00+09:00'));
  assert.equal(verifiedIndexClose(row,row.key,cutoff),expected[row.key]);
  for(const time of ['15:00:00','15:20:00','15:29:59']) {
   const early=atTime(row,time);
   assert.equal(verifiedIndexClose(early,row.key,cutoff),null);
   assert.equal(indexCloseRows({majorIndices:[early]},cutoff)[row.key],NO_CLOSE_VALUE);
  }
  const exact=atTime(row,'15:30:00');
  assert.equal(verifiedIndexClose(exact,row.key,'2026-11-26T15:30:00+09:00'),expected[row.key]);
  assert.equal(verifiedIndexClose(exact,row.key,'2026-11-26T15:29:59+09:00'),null);
 }
});
test('official delayed session, holidays, unsupported dates and later vendor end fail conservatively',async()=>{
 const {verifiedIndexClose}=await import('../scripts/briefing-index-close.mjs');
 for(const row of rows) {
  const special=onDate(row,'2026-11-19');
  for(const time of ['15:20:00','15:30:00','16:29:59']) assert.equal(verifiedIndexClose(atTime(special,time,'2026-11-19'),row.key,'2026-11-19T17:00:00+09:00'),null);
  const close=atTime(special,'16:30:00','2026-11-19');
  assert.equal(verifiedIndexClose(close,row.key,'2026-11-19T16:30:00+09:00'),expected[row.key]);
  assert.equal(verifiedIndexClose(close,row.key,'2026-11-19T16:29:59+09:00'),null);
  for(const day of ['2026-11-28','2026-12-25','2026-12-31','2027-01-04']) assert.equal(verifiedIndexClose(onDate(row,day),row.key,`${day}T17:00:00+09:00`),null);
  const later=structuredClone(row);later.closeEvidence.sessionEnd=epoch('2026-11-26T17:00:00+09:00');
  assert.equal(verifiedIndexClose(later,row.key,'2026-11-26T17:10:00+09:00'),null);
 }
});
test('calendar helper rejects invalid/unsupported inputs and manual holidays without vendor overrides',async()=>{
 const {krxCashCloseEpoch}=await import('../scripts/krx-cash-session.mjs');
 for(const day of [null,'invalid','2026-02-30','2027-11-18','2026-01-01']) assert.equal(krxCashCloseEpoch(day,'kospi'),null);
 assert.equal(krxCashCloseEpoch('2026-11-26','nasdaq'),null);
 assert.equal(krxCashCloseEpoch('2026-11-26','kospi'),epoch('2026-11-26T15:30:00+09:00'));
 assert.equal(krxCashCloseEpoch('2026-11-19','kosdaq'),epoch('2026-11-19T16:30:00+09:00'));
 const old=process.env.KRX_HOLIDAYS;
 try {process.env.KRX_HOLIDAYS='2026-11-26';assert.equal(krxCashCloseEpoch('2026-11-26','kospi'),null);}
 finally {if(old===undefined) delete process.env.KRX_HOLIDAYS;else process.env.KRX_HOLIDAYS=old;}
});
test('captured rows through final app JSON and both HTML paths retain actual closes and omit pre-close quotes',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
 const repo=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'briefing-floor-'));
 const artifacts=['index.html','report/index.html','report/data/report.json','report/data/market-research.json'];
 const before=artifacts.map(p=>fs.readFileSync(path.join(repo,p)));
 try {
  const code=`
   import {mock} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
   mock.timers.enable({apis:['Date'],now:new Date('2026-11-26T16:05:00+09:00')});
   process.env.REPORT_LLM_MOCK='1';process.env.PRESERVE_EXISTING_REPORTS='0';process.env.BRIEFING_PHASE='post_market';
   delete process.env.BRIEFING_AS_OF;delete process.env.BRIEFING_TRADING_DATE;
   const mod=await import(${JSON.stringify(pathToFileURL(path.join(repo,'scripts/generate-market-briefing.mjs')).href)});
   await mod.__testMainCompleted;
   for(const [mode,indices] of ${JSON.stringify([['actual',rows],['early',rows.map(r=>atTime(r,'15:20:00'))],['exact',rows.map(r=>atTime(r,'15:30:00'))]])}) {
    const report={marketSummary:{kospi:'4,723.35 (▼ 5.65%)',kosdaq:'660.00 (▼ 0.88%)',summary:'업종별 흐름 점검'},sectorThemes:{weak:'반도체 흐름 점검',strong:'자동차 거래대금 증가'},notableStocks:{surging:['A 상승','B 상승'],plunging:['C 하락','D 하락']},tomorrowStrategy:{outlook:'공시와 수급 점검',checklist:['업종별 거래대금 점검']}};
    await mod.__testWritePreparedReportArtifacts({collectedAt:'2026-11-26T16:00:00+09:00',majorIndices:indices},report,{provider:'test',model:'test'});
    await fs.mkdir('report/data',{recursive:true});
    await fs.copyFile('public/report/index.html','index.html');await fs.copyFile('public/report/index.html','report/index.html');
    await fs.copyFile('public/report/data/report.json','report/data/report.json');
    const app=JSON.parse(await fs.readFile('report/data/report.json','utf8')).report;
    for(const key of ['kospi','kosdaq']) assert.equal(app.marketSummary[key],mode==='early'?'정규장 종가 수치 미제공':${JSON.stringify(expected)}[key]);
    for(const file of ['index.html','report/index.html']) {
     const html=await fs.readFile(file,'utf8');
     const articles=[...html.matchAll(/<article\\b[^>]*>[\\s\\S]*?<\\/article>/gu)].filter(m=>m[0].includes('report-post-market')).map(m=>m[0]).join('');
     for(const key of ['kospi','kosdaq']) assert.ok(articles.includes(app.marketSummary[key]));
     assert.doesNotMatch(articles,/4,723.35|660.00|5.65%/);
     if(mode==='early') assert.doesNotMatch(articles,/4,711.21|655.71/);
    }
   }
   mock.timers.reset();
  `;
  execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,stdio:'pipe',timeout:30000});
  artifacts.forEach((p,i)=>assert.deepEqual(fs.readFileSync(path.join(repo,p)),before[i]));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
