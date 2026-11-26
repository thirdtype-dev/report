import { evaluateTradingDay } from './krx-business-day.mjs';

// Reviewed exchange cash-market rules, never supplied by quotes or writer data.
// Normal KOSPI/KOSDAQ cash close: 15:30 KST.
// https://regulation.krx.co.kr/contents/RGL/03/03010100/RGL03010100T1.jsp
// https://regulation.krx.co.kr/contents/RGL/03/03020401/RGL03020401.jsp
const SPECIAL_CLOSES = Object.freeze({
  '2026-11-19': Object.freeze({
    time: '16:30:00',
    kospi: 'https://kind.krx.co.kr/external/2026/11/05/000141/20261105000216/99303.htm',
    kosdaq: 'https://kind.krx.co.kr/external/2026/11/05/000145/20261104001218/70780.htm'
  })
});

export function krxCashCloseEpoch(day, key) {
  if (!['kospi','kosdaq'].includes(key) || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10) !== day) return null;
  const [year,month,date] = day.split('-').map(Number);
  // Reuse the existing calendar as an additional deny gate. The workflow's
  // authoritative synced-calendar check remains mandatory and unchanged.
  try {
    if (!evaluateTradingDay({year,month,day:date,ymd:day}).isTradingDay) return null;
  } catch { return null; } // Unknown calendar coverage must not imply a close.
  const special = SPECIAL_CLOSES[day];
  if (special && (!special[key] || !/^\d{2}:\d{2}:\d{2}$/u.test(special.time) || special.time < '15:30:00')) return null;
  const epoch = Date.parse(`${day}T${special?.time ?? '15:30:00'}+09:00`)/1000;
  return Number.isFinite(epoch) ? epoch : null;
}
