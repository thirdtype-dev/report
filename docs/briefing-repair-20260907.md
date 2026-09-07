# September 7 post-market publication repair

The 16:00 and 16:05 KST runs failed with `notable_stock_source_unavailable`; the 16:10 run rejected placeholder copy twice and then timed out. Runs: 34093354102, 34093742384, 34094142737.

The writer prompt requested `확인 필요` for unavailable data while the quality gate prohibited the same phrase. Remove the contradictory instruction and pass validation feedback into bounded writer retries. Keep the existing model, attempt limit, timeout, and quality gates.

Add short, time-bounded rising- and falling-stock RSS queries and bounded transport retries. A live rising-stock query for September 7 returned 41 items published by 16:00 KST. The user's final instruction restores falling stocks: both rising and falling lists require at least two entries and are rendered. Market-wide and sector risk analysis remains intact.

For the requested delayed republication, the optional `as_of` workflow input accepts post-market cutoffs within 48 hours, e.g. `2026-09-07T16:00:00+09:00`. News published later is excluded; later or untimestamped Yahoo quotes are rejected. Korean backfill indices use Npay daily rows matching the exact requested date, with signed change/percentage consistency validation. A newer committed briefing blocks backfill. This is deliberately not a general historical data reconstruction facility: unavailable historical inputs still fail closed.

Second review found unbounded external HTTP requests and a generation-to-push race. Each source request now has a 10-second abort deadline. The publisher checks the latest fetched main tree before copying artifacts, refusing to replace newer briefings on every retry. Source coverage counts are logged before invoking the writer so future failures can distinguish missing evidence from writer errors.

Validation: `node --test --test-concurrency=1 tests/*.test.js` passed all 105 tests, including restored falling-stock rendering, exact-date daily-close parsing, and stale publication rejection. Parallel execution had an existing shared-output-file race in realtime tests; sequential execution passes.

Remaining limits: transport and LLM provider failures can still exhaust bounded retries; the 90-second writer timeout and existing provider policy remain. Google RSS is still the news source, and lack of verifiable evidence must block publication. Source requests are sequential, so repeated failures can consume the workflow's overall budget. A successful Git push alone is not proof that Pages has deployed the briefing: check the public HTML's requested date, phase, and content after the workflow. In this environment, a temporary push-triggered dispatcher used the connected GitHub permissions to request the existing publish workflow with the explicit September 7 cutoff; no browser login was needed.

## Live closeout

- Publish workflow `34163040118`: success.
- Publication commit: `7d25a41521c0e90e5cec91e20506df853e87a737`.
- Pages workflow `34163198891`: success.
- Public readback at `https://thirdtype-dev.github.io/report/report/`: top title `2026-09-07 16:00`, both rising/falling lists present, no placeholder phrases.
- Writer remains OpenRouter `deepseek/deepseek-v4-flash`, without provider fallback.
- Temporary dispatcher removed in `a2e0c2dc1c7517457b40afe17c822fc98226f4ac`.
- The initial backfill run `34162589969` failed closed on untimestamped KOSPI fallback. Exact-date daily closes fixed this rather than weakening the date guard.
