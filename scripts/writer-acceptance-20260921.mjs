// Isolated operator acceptance probe. Does not generate, copy or publish report files.
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const phase = process.env.BRIEFING_PHASE;
assert.ok(['pre_market', 'post_market'].includes(phase));
const sourcePath = resolve('scripts/generate-market-briefing.mjs');
const probePath = resolve('scripts/.briefing-acceptance-20260921.mjs');
const source = await readFile(sourcePath, 'utf8');
const entry = 'main().catch((error) => {';
assert.equal(source.split(entry).length, 2, 'expected one generator entry point');
const isolated = source.replace(entry, 'Promise.resolve().catch((error) => {')
  + '\nexport { writeReport as smokeWriteReport, renderArticle as smokeRenderArticle, briefingQualityIssues as smokeQualityIssues };\n';
await writeFile(probePath, isolated);
try {
  const mod = await import(pathToFileURL(probePath));
  const research = JSON.parse(await readFile(process.env.SMOKE_RESEARCH_PATH, 'utf8'));
  assert.equal(research.phase, phase);
  const started = Date.now();
  const { report, writer } = await mod.smokeWriteReport(research);
  const issues = mod.smokeQualityIssues(research, report);
  assert.deepEqual(issues, [], `quality issues: ${issues.join(',')}`);
  const { validateBriefingHtml } = await import(pathToFileURL(resolve('scripts/check-briefing-recovery.mjs')));
  const htmlResult = validateBriefingHtml(mod.smokeRenderArticle(report), phase, new Date(`${process.env.BRIEFING_TRADING_DATE}T00:00:00+09:00`));
  assert.equal(htmlResult.shouldRecover, false, JSON.stringify(htmlResult));
  console.log(JSON.stringify({ smoke: 'live_writer_without_publication', phase, date: process.env.BRIEFING_TRADING_DATE, elapsedMs: Date.now()-started, writer, qualityIssues: issues, articleQuality: htmlResult.articleQuality }));
} finally {
  await unlink(probePath);
}
