const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const HOLIDAYS_BY_YEAR = {
  2026: new Set([
    '2026-01-01',
    '2026-02-16',
    '2026-02-17',
    '2026-02-18',
    '2026-03-01',
    '2026-05-01',
    '2026-05-05',
    '2026-05-25',
    '2026-06-06',
    '2026-08-15',
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
    '2026-10-03',
    '2026-10-09',
    '2026-12-25',
    '2026-12-31'
  ])
};

function getSeoulDateParts(date = new Date()) {
  const parts = SEOUL_DATE_FORMATTER.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number.parseInt(values.year, 10),
    month: Number.parseInt(values.month, 10),
    day: Number.parseInt(values.day, 10),
    ymd: `${values.year}-${values.month}-${values.day}`
  };
}

function getTargetDate() {
  const override = process.env.KRX_CHECK_DATE?.trim();
  if (!override) {
    return getSeoulDateParts();
  }

  const normalized = override.replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid KRX_CHECK_DATE: ${override}`);
  }

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    ymd: `${match[1]}-${match[2]}-${match[3]}`
  };
}

function isWeekend({ year, month, day }) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function isYearEndClosed({ year, month, day, ymd }) {
  if (ymd.endsWith('-12-31')) {
    return true;
  }

  const dec31Weekday = new Date(Date.UTC(year, 11, 31)).getUTCDay();
  if (dec31Weekday === 6) {
    return month === 12 && day === 30;
  }
  if (dec31Weekday === 0) {
    return month === 12 && day === 29;
  }
  return false;
}

function getManualHolidays() {
  return new Set(
    (process.env.KRX_HOLIDAYS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        if (/^\d{8}$/.test(value)) {
          return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
        }
        return value;
      })
  );
}

function evaluateTradingDay(targetDate = getTargetDate()) {
  if (isWeekend(targetDate)) {
    return { ...targetDate, isTradingDay: false, reason: 'weekend' };
  }

  const manualHolidays = getManualHolidays();
  if (manualHolidays.has(targetDate.ymd)) {
    return { ...targetDate, isTradingDay: false, reason: 'manual_holiday' };
  }

  if (isYearEndClosed(targetDate)) {
    return { ...targetDate, isTradingDay: false, reason: 'year_end_closure' };
  }

  const annualHolidays = HOLIDAYS_BY_YEAR[targetDate.year];
  if (annualHolidays?.has(targetDate.ymd)) {
    return { ...targetDate, isTradingDay: false, reason: 'annual_holiday' };
  }

  return { ...targetDate, isTradingDay: true, reason: 'business_day' };
}

try {
  const result = evaluateTradingDay();
  process.stdout.write(`is_trading_day=${result.isTradingDay}\n`);
  process.stdout.write(`trading_date=${result.ymd}\n`);
  process.stdout.write(`skip_reason=${result.reason}\n`);
} catch (error) {
  console.error('[krx-business-day] failed', error);
  process.exitCode = 1;
}
