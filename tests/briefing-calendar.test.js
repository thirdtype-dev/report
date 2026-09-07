import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
function calendar(date) {
  return spawnSync(process.execPath, ['scripts/krx-business-day.mjs'], {
    encoding: 'utf8', env: { ...process.env, KRX_CHECK_DATE: date, KRX_HOLIDAYS: '' }
  });
}
test('calendar blocks the three previously missing substitute holidays', () => {
  for (const date of ['2026-03-02', '2026-08-17', '2026-10-05']) {
    const result = calendar(date);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /is_trading_day=false/);
  }
  assert.match(calendar('2026-09-08').stdout, /is_trading_day=true/);
});
test('invalid dates and unsupported calendar years fail closed', () => {
  for (const date of ['2026-02-30', '2026-13-01', '2027-01-04']) {
    const result = calendar(date);
    assert.notEqual(result.status, 0, date);
    assert.doesNotMatch(result.stdout, /is_trading_day=true/);
  }
});
