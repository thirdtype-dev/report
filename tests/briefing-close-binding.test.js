const test = require('node:test');
const assert = require('node:assert/strict');
const cutoff='2026-11-25T16:00:00+09:00';
const writer=()=>({marketSummary:{kospi:'4,723.35 (▼ 5.65%)',kosdaq:'660.00 (▼ 0.88%)',summary:'코스피 장중 -5.65%'},sectorThemes:{weak:'SK하이닉스 9%대 하락',strong:'삼성전자 9.87% 하락'},notableStocks:{surging:['A 상승','B 상승'],plunging:['SK하이닉스 9%대 하락','삼성전자 -9.87%']},tomorrowStrategy:{outlook:'삼성전자 9%대 하락',checklist:['SK하이닉스 9%대 하락']}});
test('same-date delayed quotes cannot authenticate writer index rows or sector/checklist stock percentages',async()=>{
 const {finalizeEvidenceCopy,finalCopyIssues}=await import('../scripts/briefing-evidence-boundary.mjs');
 const research={collectedAt:cutoff,majorIndices:[{key:'kospi',currentPrice:'4,697.51',changePercent:'-6.16%',sourceDate:'2026-11-25',updatedAt:cutoff,status:'delayed'}]};
 const r=finalizeEvidenceCopy(writer(),research,{phase:'post_market',informationAsOf:cutoff});
 assert.doesNotMatch(JSON.stringify(r),/4,723.35|660.00|9%대|9.87%|5.65%/);
 assert.ok(finalCopyIssues(writer(),research,{phase:'post_market',informationAsOf:cutoff}).length);
});
const epoch=s=>Date.parse(s)/1000;
function chart(key='kospi',close=4697.51,previous=5005.92) {
 const day='2026-11-25';
 return {chart:{error:null,result:[{meta:{symbol:key==='kospi'?'^KS11':'^KQ11',exchangeTimezoneName:'Asia/Seoul',dataGranularity:'1d',regularMarketPrice:close,regularMarketTime:epoch(`${day}T15:30:00+09:00`),previousClose:previous,currentTradingPeriod:{regular:{start:epoch(`${day}T09:00:00+09:00`),end:epoch(`${day}T15:30:00+09:00`)}}},timestamp:[epoch('2026-11-24T09:00:00+09:00'),epoch(`${day}T09:00:00+09:00`)],indicators:{quote:[{close:[previous,close]}]}}]}};
}
async function normalized(key='kospi',raw=chart()) {
 const {yahooCloseEvidence}=await import('../scripts/briefing-index-close.mjs');
 const m=raw.chart.result[0].meta;
 return {key,sourceDate:'2026-11-25',status:'delayed',currentPrice:m.regularMarketPrice.toFixed(2),changePercent:(100*(m.regularMarketPrice-m.previousClose)/m.previousClose).toFixed(2)+'%',sourceUrl:`https://finance.yahoo.com/quote/${encodeURIComponent(key==='kospi'?'^KS11':'^KQ11')}`,closeEvidence:yahooCloseEvidence(key,raw)};
}
test('supported daily-chart session and bar evidence overrides conflicting writer index rows',async()=>{
 const {finalizeEvidenceCopy,finalCopyIssues}=await import('../scripts/briefing-evidence-boundary.mjs');
 const research={majorIndices:[await normalized(),await normalized('kosdaq',chart('kosdaq',650.64,665.89))]};
 const options={phase:'post_market',informationAsOf:cutoff};
 const r=finalizeEvidenceCopy(writer(),research,options);
 assert.equal(r.marketSummary.kospi,'4,697.51 (▼ 6.16%)');
 assert.equal(r.marketSummary.kosdaq,'650.64 (▼ 2.29%)');
 assert.deepEqual(finalCopyIssues(r,research,options),[]);
 assert.deepEqual(finalizeEvidenceCopy(r,research,options),r);
 for(const [close,prev,expected] of [[102,100,'102.00 (▲ 2.00%)'],[100,100,'100.00 (→ 0.00%)']]) {
  assert.equal(finalizeEvidenceCopy(writer(),{majorIndices:[await normalized('kospi',chart('kospi',close,prev))]},options).marketSummary.kospi,expected);
 }
});
test('missing, wrong-date, intraday, incomplete and conflicting source evidence stays neutral',async()=>{
 const {verifiedIndexClose}=await import('../scripts/briefing-index-close.mjs');
 const original=await normalized();
 for(const mutate of [x=>x.sourceDate='2026-11-24',x=>x.changePercent='+6.16%',x=>x.currentPrice='4723.35',x=>x.closeEvidence=null,x=>x.closeEvidence.sessionEnd=epoch('2026-11-25T17:00:00+09:00'),x=>x.closeEvidence.quoteTime=epoch('2026-11-25T15:10:00+09:00'),x=>x.closeEvidence.barTime=epoch('2026-11-24T09:00:00+09:00'),x=>x.closeEvidence.close=4700,x=>x.closeEvidence.previousClose=4900,x=>x.closeEvidence.symbol='^KQ11']) {
  const x=structuredClone(original);mutate(x);assert.equal(verifiedIndexClose(x,'kospi',cutoff),null);
 }
 for(const cutoff of ['2026-11-24T16:00:00+09:00','2026-11-25T15:29:59+09:00','2026-11-26T16:00:00+09:00','invalid']) assert.equal(verifiedIndexClose(original,'kospi',cutoff),null);
 assert.equal(verifiedIndexClose(original,'kospi','2026-11-25T07:00:00Z'),'4,697.51 (▼ 6.16%)');
});
test('stock close evidence is applied across sector, summary, strategy and checklist, with sign and approximation checks',async()=>{
 const {finalizeEvidenceCopy}=await import('../scripts/briefing-evidence-boundary.mjs');
 const proof={name:'SK하이닉스',changePercent:-11.05,tradingDate:'2026-11-25',session:'regular_close',status:'official_close',marketTime:'2026-11-25T15:30:00+09:00',sourceUrl:'https://data.krx.co.kr/close'};
 for(const value of ['SK하이닉스 -11.05%','SK하이닉스 11.05% 하락','SK하이닉스 9%대 하락','SK하이닉스 +11.05% 하락','SK하이닉스 -11.05% 상승','SK하이닉스 11.05%']) {
  const report={sectorThemes:{weak:value},marketSummary:{summary:value},tomorrowStrategy:{outlook:value,checklist:[value]}};
  const r=finalizeEvidenceCopy(report,{stockCloseEvidence:[proof]},{phase:'post_market',informationAsOf:cutoff});
  const expected = ['SK하이닉스 -11.05%','SK하이닉스 11.05% 하락'].includes(value);
  for(const text of [r.sectorThemes.weak,r.marketSummary.summary,r.tomorrowStrategy.outlook,r.tomorrowStrategy.checklist[0]]) assert.equal(text===value,expected);
 }
});
test('actual collector normalizer -> final app JSON -> both website HTML paths bind or omit conflicting rows',()=>{
 const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');const {pathToFileURL}=require('node:url');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'briefing-close-entry-'));
 try {
  const moduleUrl=pathToFileURL(path.resolve(__dirname,'../scripts/generate-market-briefing.mjs')).href;
  const code=`
    import { mock } from 'node:test';
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    mock.timers.enable({apis:['Date'],now:new Date('2026-11-25T16:05:00+09:00')});
    process.env.REPORT_LLM_MOCK='1';process.env.PRESERVE_EXISTING_REPORTS='0';process.env.BRIEFING_PHASE='post_market';
    delete process.env.BRIEFING_AS_OF;delete process.env.BRIEFING_TRADING_DATE;
    const mod=await import(${JSON.stringify(moduleUrl)});
    await mod.__testMainCompleted;
    const raw=${JSON.stringify([chart(),chart('kosdaq',650.64,665.89)])};
    const keys=['kospi','kosdaq'];
    const indices=raw.map((json,i)=>mod.__testNormalizeYahooIndex({key:keys[i],title:keys[i].toUpperCase(),symbol:i?'^KQ11':'^KS11'},json));
    assert.equal(indices[0].status,'delayed');
    assert.equal(indices[0].closeEvidence.kind,'yahoo_completed_daily_bar');
    for (const mode of ['verified','missing','intraday','other_trade_date','wrong_percent']) {
      const research={collectedAt:'2026-11-25T16:00:00+09:00',majorIndices:structuredClone(indices)};
      if(mode==='missing') research.majorIndices=[];
      if(mode==='intraday') for(const index of research.majorIndices) index.closeEvidence.quoteTime-=1200;
      if(mode==='other_trade_date') research.collectedAt='2026-11-24T16:00:00+09:00';
      if(mode==='wrong_percent') for(const index of research.majorIndices) index.changePercent='+6.16%';
      await mod.__testWritePreparedReportArtifacts(research,${JSON.stringify(writer())},{provider:'test',model:'test'});
      // Exactly the workflow's local artifact-copy entry points. No git/publish.
      await fs.mkdir('report/data',{recursive:true});
      await fs.copyFile('public/report/index.html','index.html');
      await fs.copyFile('public/report/index.html','report/index.html');
      await fs.copyFile('public/report/data/report.json','report/data/report.json');
      const app=JSON.parse(await fs.readFile('report/data/report.json','utf8')).report;
      const expected=mode==='verified'?'4,697.51 (▼ 6.16%)':'정규장 종가 수치 미제공';
      assert.equal(app.marketSummary.kospi,expected);
      assert.equal(app.marketSummary.kosdaq,mode==='verified'?'650.64 (▼ 2.29%)':'정규장 종가 수치 미제공');
      assert.doesNotMatch(JSON.stringify(app),/4,723.35|660.00|9%대|9.87%|5.65%/);
      for(const file of ['index.html','report/index.html']) {
        const html=await fs.readFile(file,'utf8');
        const articles=[...html.matchAll(/<article\\b[^>]*>[\\s\\S]*?<\\/article>/gu)].filter(m=>m[0].includes('report-post-market')).map(m=>m[0]).join('');
        assert.ok(articles.includes(expected));
        assert.doesNotMatch(articles,/4,723.35|660.00|9%대|9.87%|5.65%/);
      }
      assert.equal(await fs.readFile('index.html','utf8'),await fs.readFile('report/index.html','utf8'));
    }
    mock.timers.reset();
  `;
  execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,stdio:'pipe',timeout:30000});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('the supported normalizer does not manufacture session proof from plain delayed/intraday metadata',async()=>{
 const {yahooCloseEvidence}=await import('../scripts/briefing-index-close.mjs');
 for(const mutate of [r=>delete r.chart.result[0].meta.currentTradingPeriod,r=>r.chart.result[0].meta.dataGranularity='5m',r=>r.chart.result[0].meta.symbol='OTHER',r=>r.chart.result[0].meta.exchangeTimezoneName='UTC',r=>r.chart.result[0].indicators.quote[0].close=[]]) {
  const raw=chart();mutate(raw);assert.equal(yahooCloseEvidence('kospi',raw),null);
 }
});
