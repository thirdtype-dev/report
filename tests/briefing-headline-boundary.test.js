const test=require('node:test');
const assert=require('node:assert/strict');
const fixture=require('./fixtures/headline-source-boundary/20261127.json');
test('final field gate catches leftover source boundaries and preserves internal separators',async()=>{
 const {finalCopyIssues}=await import('../scripts/briefing-evidence-boundary.mjs');
 for(const text of ['상승폭 반납 |가 확인돼','상승폭 반납 ｜','상승폭 반납 | / 상방: 상승','상승폭 반납 |이 확인돼']) {
  assert.ok(finalCopyIssues({a:[text]},{},{phase:'pre_market'}).includes('dangling_source_separator'));
 }
 for(const text of ['KOSPI | KOSDAQ 비교','금리 인상에 상승폭 반납','A/B 비교','상승폭 반납 등의 흐름이 나타나 변동성을 점검합니다']) assert.deepEqual(finalCopyIssues({text}),[]);
 assert.ok(finalCopyIssues(fixture.report).includes('dangling_source_separator'));
});
test('actual source -> local direction evidence -> final app and both HTML paths removes boundary before sentence synthesis',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
 const repo=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'headline-boundary-'));
 try {
  const code=`
   import {mock} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
   mock.timers.enable({apis:['Date'],now:new Date('2026-11-27T08:30:00+09:00')});
   process.env.REPORT_LLM_MOCK='1';process.env.PRESERVE_EXISTING_REPORTS='0';process.env.BRIEFING_PHASE='pre_market';
   delete process.env.BRIEFING_AS_OF;delete process.env.BRIEFING_TRADING_DATE;
   const mod=await import(${JSON.stringify(pathToFileURL(path.join(repo,'scripts/generate-market-briefing.mjs')).href)});
   const gate=await import(${JSON.stringify(pathToFileURL(path.join(repo,'scripts/briefing-evidence-boundary.mjs')).href)});
   await mod.__testMainCompleted;
   const fixture=${JSON.stringify(fixture)};
   for(const [input,expected] of [[fixture.candidate.title,'코스피 4711 강보합···금리 인상에 상승폭 반납'],['상승폭 반납 ｜ - 시사저널e','상승폭 반납'],['상승폭 반납 ||','상승폭 반납'],['KOSPI | KOSDAQ 비교','KOSPI | KOSDAQ 비교']]) assert.equal(mod.__testCleanMarketEventHeadline(input),expected);
   const research={generatedAt:'2026-11-26T23:30:00Z',collectedAt:'2026-11-26T23:30:00Z',informationAsOf:'2026-11-27T08:30:00+09:00',sectorThemeNewsCandidates:[fixture.candidate]};
   const signals=mod.__testBuildMarketEventSignals(research);
   const rates=signals.find(s=>s.directionEvidence?.includes('상승폭 반납'));
   assert.ok(rates);assert.equal(rates.directionEvidence,'금리 인상에 상승폭 반납');
   for(const signals of [[fixture.signal],[rates]]) {
    await mod.__testWritePreparedReportArtifacts({...research,marketEventSignals:signals},fixture.report,{provider:'test',model:'test'});
    await fs.mkdir('report/data',{recursive:true});
    await fs.copyFile('public/report/index.html','index.html');await fs.copyFile('public/report/index.html','report/index.html');
    await fs.copyFile('public/report/data/report.json','report/data/report.json');
    const app=JSON.parse(await fs.readFile('report/data/report.json','utf8')).report;
    for(const text of [app.openingStrategy.oneLineStrategy,app.sectorWeather.rainy,app.disclosuresAndNews.majorNews]) {
     assert.match(text,/금리 인상에 상승폭 반납/);assert.doesNotMatch(text,/[|｜]/);
    }
    assert.match(app.openingStrategy.oneLineStrategy,/등의 흐름이 나타나/);
    assert.deepEqual(gate.finalCopyIssues(app,{}, {phase:'pre_market'}),[]);
    const reintroduced=structuredClone(app);reintroduced.sectorWeather.rainy+=' |';
    assert.ok(gate.finalCopyIssues(reintroduced,{}, {phase:'pre_market'}).includes('dangling_source_separator'));
    for(const file of ['index.html','report/index.html']) {
     const html=await fs.readFile(file,'utf8');
     const articles=[...html.matchAll(/<article\\b[^>]*>[\\s\\S]*?<\\/article>/gu)].map(m=>m[0]).join('');
     assert.match(articles,/금리 인상에 상승폭 반납/);assert.doesNotMatch(articles,/반납\\s*[|｜]|반납가/);
    }
   }
   mock.timers.reset();
  `;
  execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,stdio:'pipe',timeout:30000});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
