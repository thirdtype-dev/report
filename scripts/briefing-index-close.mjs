import { krxCashCloseEpoch } from './krx-cash-session.mjs';
// Evidence comes from the existing Yahoo daily chart response, not writer text.
// A delayed quote alone, Npay date row, or collection time is NOT a closing bar.
const SYMBOLS = { kospi: '^KS11', kosdaq: '^KQ11' };
const seoul = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
export const NO_CLOSE_VALUE = '정규장 종가 수치 미제공';
export function seoulTradingDate(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? seoul.format(new Date(ms)) : null;
}
export function yahooCloseEvidence(key, json) {
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  const period = meta?.currentTradingPeriod?.regular;
  const timestamps = result?.timestamp;
  const values = result?.indicators?.quote?.[0]?.close;
  if (!SYMBOLS[key] || json?.chart?.error || meta?.symbol !== SYMBOLS[key]
      || meta.exchangeTimezoneName !== 'Asia/Seoul' || meta.dataGranularity !== '1d'
      || !Array.isArray(timestamps) || !Array.isArray(values) || timestamps.length !== values.length
      || ![period?.start,period?.end,meta.regularMarketTime,meta.regularMarketPrice].every(Number.isFinite)) return null;
  const bars = timestamps.map((time,i)=>({time,close:values[i]}));
  const current = bars.filter(bar=>bar.time >= period.start && bar.time < period.end);
  const previous = bars.filter(bar=>bar.time < period.start && Number.isFinite(bar.close) && bar.close>0).sort((a,b)=>a.time-b.time).at(-1);
  if (current.length !== 1 || !previous) return null;
  return {kind:'yahoo_completed_daily_bar',symbol:meta.symbol,timeZone:meta.exchangeTimezoneName,
    sessionStart:period.start,sessionEnd:period.end,quoteTime:meta.regularMarketTime,
    quotePrice:meta.regularMarketPrice,barTime:current[0].time,close:current[0].close,
    previousBarTime:previous.time,previousClose:previous.close};
}
export function verifiedIndexClose(index, key, cutoff) {
  const e = index?.closeEvidence;
  const limit = Date.parse(cutoff)/1000;
  const day = seoulTradingDate(cutoff);
  const cashClose = krxCashCloseEpoch(day, key);
  const date = seconds=>Number.isFinite(seconds) ? seoulTradingDate(new Date(seconds*1000).toISOString()) : null;
  if (cashClose === null || !e || e.kind !== 'yahoo_completed_daily_bar' || e.symbol !== SYMBOLS[key] || e.timeZone !== 'Asia/Seoul'
      || index.status === 'unavailable' || index.key !== key || index.sourceUrl !== `https://finance.yahoo.com/quote/${encodeURIComponent(SYMBOLS[key])}`
      || !Number.isFinite(limit) || ![e.sessionStart,e.sessionEnd,e.quoteTime,e.quotePrice,e.barTime,e.close,e.previousBarTime,e.previousClose].every(Number.isFinite)
      || e.close<=0 || e.previousClose<=0 || e.sessionStart>=e.sessionEnd
      || e.barTime<e.sessionStart || e.barTime>=e.sessionEnd || e.previousBarTime>=e.sessionStart
      || e.quoteTime<Math.max(e.sessionEnd,cashClose) || e.quoteTime>limit || Math.max(e.sessionEnd,cashClose)>limit
      || date(e.sessionStart)!==day || date(e.sessionEnd)!==day || date(e.quoteTime)!==day
      || date(e.barTime)!==day || date(e.previousBarTime)>=day || index.sourceDate!==day
      || Math.abs(e.quotePrice-e.close)>0.005) return null;
  const price = Number(String(index.currentPrice).replaceAll(',',''));
  const percent = 100*(e.close-e.previousClose)/e.previousClose;
  const normalizedPercent = Number(String(index.changePercent).replace('%',''));
  if (!Number.isFinite(price) || !Number.isFinite(normalizedPercent) || Math.abs(price-e.close)>0.005
      || Math.abs(normalizedPercent-Number(percent.toFixed(2)))>0.001) return null;
  const rounded = Number(percent.toFixed(2));
  return `${e.close.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${rounded<0?'▼':rounded>0?'▲':'→'} ${Math.abs(rounded).toFixed(2)}%)`;
}
export function indexCloseRows(research, cutoff, tradingDate = seoulTradingDate(cutoff)) {
  return Object.fromEntries(Object.keys(SYMBOLS).map(key=>{
    const matches = (research?.majorIndices ?? []).filter(index=>index.key===key);
    return [key,seoulTradingDate(cutoff)===tradingDate && matches.length===1 ? verifiedIndexClose(matches[0],key,cutoff) ?? NO_CLOSE_VALUE : NO_CLOSE_VALUE];
  }));
}
