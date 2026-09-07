# September 7 post-market publication repair

The 16:00 and 16:05 KST runs failed with `notable_stock_source_unavailable`; the 16:10 run rejected placeholder copy twice and then timed out. Runs: 34093354102, 34093742384, 34094142737.

The writer prompt requested `확인 필요` for unavailable data while the quality gate prohibited the same phrase. Remove the contradictory instruction and pass validation feedback into bounded writer retries. Keep the existing model, attempt limit, timeout, and quality gates.

Add short, time-bounded rising-stock RSS queries and bounded transport retries. A live query for September 7 returned 41 items published by 16:00 KST. Per user instruction, remove falling stocks from the writer schema, required fields, publication JSON, and rendered list. Market-wide and sector risk analysis remains intact.

For the requested delayed republication, the optional `as_of` workflow input accepts post-market cutoffs within 48 hours, e.g. `2026-09-07T16:00:00+09:00`. News published later is excluded; later or untimestamped Yahoo quotes are rejected; untimestamped KOSPI fallback cannot be used for backfill. A newer committed briefing blocks backfill. This is deliberately not a general historical data reconstruction facility: unavailable historical inputs still fail closed.

Validation: `node --test --test-concurrency=1 tests/*.test.js` passed all 103 tests. Parallel execution had an existing shared-output-file race in realtime tests; sequential execution passes. Live publication must still be checked separately.
