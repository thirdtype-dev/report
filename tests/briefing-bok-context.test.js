const test = require('node:test');
const assert = require('node:assert/strict');
const decision = '한국은행은 기준금리를 연 3.00%에서 3.25%로 인상했습니다.';
const upcoming = '한국은행 기준금리 결정 결과가 발표될 예정입니다.';
const neutral = '한국은행 기준금리 결정은 공식 원문과 발표 시각의 검증 전까지 수치와 진행 단계 판단을 보류합니다.';
test('BOK numeric and percent-free stage claims stay macro-specific and neutral without a supported decision collector', async () => {
 const {finalizeEvidenceCopy, finalCopyIssues} = await import('../scripts/briefing-evidence-boundary.mjs');
 // RSS publication time, an official-looking URL, or a writer-supplied object is
 // not proof that an exact official decision was available at the cutoff.
 for (const cutoff of ['2026-11-26T08:30:00+09:00','2026-11-26T09:49:59+09:00','2026-11-26T09:50:00+09:00','2026-11-26T09:50:01+09:00','2026-11-26T16:00:00+09:00','2026-11-27T16:00:00+09:00','invalid']) {
  for (const sourceUrl of ['https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=11067084','https://www.bok.or.kr.evil.example/decision','https://news.google.com/rss/articles/example']) {
   for (const publishedAt of ['2026-11-25T09:50:00+09:00','2026-11-26T09:50:00+09:00','2026-11-27T09:50:00+09:00',null]) {
    const research={news:[{title:decision,source:'한국은행',sourceUrl,publishedAt}],officialEvents:[{topic:'bok',provider:'한국은행',sourceUrl,publishedAt,rate:3.25}]};
    for (const phase of ['pre_market','post_market']) {
     const options={phase,informationAsOf:cutoff};
     for (const text of [decision,upcoming,'금통위는 기준금리를 동결했습니다.','한국은행 기준금리 결과는 미정입니다.',decision+' SK하이닉스 9%대 하락']) {
      const input={marketSummary:{summary:text},sectorThemes:{weak:text},tomorrowStrategy:{checklist:[text]}};
      assert.ok(finalCopyIssues(input,research,options).length);
      const out=finalizeEvidenceCopy(input,research,options);
      assert.equal(out.marketSummary.summary,neutral);
      assert.equal(out.sectorThemes.weak,neutral);
      assert.equal(out.tomorrowStrategy.checklist[0],neutral);
      assert.deepEqual(finalCopyIssues(out,research,options),[]);
      assert.deepEqual(finalizeEvidenceCopy(out,research,options),out);
     }
    }
   }
  }
 }
 // Context-free recovery of existing cards must not newly reject a legitimate
 // historical upcoming statement. This repair only governs new generation.
 assert.deepEqual(finalCopyIssues(upcoming),[]);
});
test('rate context does not become a stock percentage allowlist or alter unrelated prose', async()=>{
 const {finalizeEvidenceCopy}=await import('../scripts/briefing-evidence-boundary.mjs');
 const report={sectorThemes:{weak:'SK하이닉스 9%대 하락',strong:'자동차 업종 거래대금 증가'},tomorrowStrategy:{checklist:[decision,'기업 실적 발표 일정 점검']}};
 const out=finalizeEvidenceCopy(report,{}, {phase:'post_market',informationAsOf:'2026-11-26T16:00:00+09:00'});
 assert.doesNotMatch(JSON.stringify(out),/9%|3\.25/);
 assert.equal(out.tomorrowStrategy.checklist[0],neutral);
 assert.equal(out.tomorrowStrategy.checklist[1],report.tomorrowStrategy.checklist[1]);
 assert.equal(out.sectorThemes.strong,report.sectorThemes.strong);
});
test('final preparation keeps BOK context in app JSON and both HTML paths without touching existing editions',()=>{
 const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');const {pathToFileURL}=require('node:url');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'briefing-bok-entry-'));
 const repo=path.resolve(__dirname,'..');
 const artifacts=['index.html','report/index.html','report/data/report.json','report/data/market-research.json'];
 const before=artifacts.map(file=>fs.readFileSync(path.join(repo,file)));
 try {
  const moduleUrl=pathToFileURL(path.join(repo,'scripts/generate-market-briefing.mjs')).href;
  const code=`
   import {mock} from 'node:test';
   import assert from 'node:assert/strict';
   import fs from 'node:fs/promises';
   mock.timers.enable({apis:['Date'],now:new Date('2026-11-26T16:05:00+09:00')});
   process.env.REPORT_LLM_MOCK='1';process.env.PRESERVE_EXISTING_REPORTS='0';process.env.BRIEFING_PHASE='post_market';
   delete process.env.BRIEFING_AS_OF;delete process.env.BRIEFING_TRADING_DATE;
   const mod=await import(${JSON.stringify(moduleUrl)});
   await mod.__testMainCompleted;
   for(const [text,expected] of ${JSON.stringify([
     ...[decision,upcoming,decision+' SK하이닉스 9%대 하락','한은 기준금리 결정 결과가 발표될 예정입니다','한국은행 금리 결정 결과가 발표될 예정입니다','한은 금리 결정 발표 예정'].map(text=>[text,neutral]),
     ['미국의 새 관세가 발표될 예정입니다','통상 정책의 공식 발표 내용과 적용 범위·절차를 확인하며 업종별 영향을 점검합니다.'],
     ['한국은행 대출금리 동향을 점검합니다','한국은행 대출금리 동향을 점검합니다'],
     ['한은 금리 결정의 공식 원문과 발표 시각을 확인합니다','한은 금리 결정의 공식 원문과 발표 시각을 확인합니다']
    ])}) {
    const report={marketSummary:{kospi:'지수 확인',kosdaq:'지수 확인',summary:text},sectorThemes:{weak:text,strong:'자동차 거래대금 증가'},notableStocks:{surging:['A 상승','B 상승'],plunging:['C 하락','D 하락']},tomorrowStrategy:{outlook:text,checklist:[text]}};
    await mod.__testWritePreparedReportArtifacts({collectedAt:'2026-11-26T16:00:00+09:00',majorIndices:[]},report,{provider:'test',model:'test'});
    await fs.mkdir('report/data',{recursive:true});
    await fs.copyFile('public/report/index.html','index.html');
    await fs.copyFile('public/report/index.html','report/index.html');
    await fs.copyFile('public/report/data/report.json','report/data/report.json');
    const app=JSON.parse(await fs.readFile('report/data/report.json','utf8')).report;
    for(const value of [app.marketSummary.summary,app.sectorThemes.weak,app.tomorrowStrategy.outlook,...app.tomorrowStrategy.checklist]) assert.equal(value,expected);
    assert.doesNotMatch(JSON.stringify(app),/3\\.25|9%대|발표될 예정/);
    for(const file of ['index.html','report/index.html']) {
     const html=await fs.readFile(file,'utf8');
     const articles=[...html.matchAll(/<article\\b[^>]*>[\\s\\S]*?<\\/article>/gu)].filter(m=>m[0].includes('report-post-market')).map(m=>m[0]).join('');
     assert.ok(articles.includes(expected));
     assert.doesNotMatch(articles,/3\\.25|9%대|발표될 예정/);
    }
   }
   mock.timers.reset();
  `;
  execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,stdio:'pipe',timeout:30000});
  artifacts.forEach((file,i)=>assert.deepEqual(fs.readFileSync(path.join(repo,file)),before[i]));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('macro neutralization cannot wash away a source failure',async()=>{
 const {finalizeEvidenceCopy,finalCopyIssues}=await import('../scripts/briefing-evidence-boundary.mjs');
 const report={marketSummary:{summary:'한국은행 기준금리 fetch_failed_503'}};
 const options={phase:'post_market',informationAsOf:'2026-11-26T16:00:00+09:00'};
 assert.deepEqual(finalizeEvidenceCopy(report,{},options),report);
 assert.ok(finalCopyIssues(report,{},options).includes('unbound_rate_decision_copy'));
});
