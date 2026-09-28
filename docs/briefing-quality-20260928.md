# Pre-market evidence quality

Pre-market briefs use a frozen information basis of the requested KST trading
date at 08:30. News without a publication time and items after that instant are
excluded before ranking and fallback selection. Numeric quotes must also be
timestamped at or before the cutoff. KOSPI and KOSDAQ may use the latest two
completed Yahoo daily bars strictly before the target date; flow rows must be
from a prior date, and current-day auxiliary values are removed.

Directional signals use evidence local to each mentioned market, sector, or
factor. Speculative and context-only headlines cannot create confident
directional weather. Generated time and collection time remain actual
timestamps; `informationAsOf` and the article's `data-information-as-of`
attribute identify the frozen cutoff. Recovery validation requires that exact
pre-market attribute. Post-market timing and backfill behavior are unchanged.

Regression coverage is in `tests/market-briefing-quality.test.js`,
`tests/briefing-scheduler.test.js`, and `tests/report-remediation.test.js`.
