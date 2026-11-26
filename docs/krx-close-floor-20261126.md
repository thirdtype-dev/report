# Exchange cash-close floor

Production commit f42bd95c4e931a83934e45c9d21d39f3072b1723 supplied both Yahoo
session ends as 15:00 KST. Its actual KOSPI/KOSDAQ quote times were 15:32:50 and
15:33:00 and its daily close math was valid. The two unmodified normalized rows
are captured in tests/fixtures/krx-close-floor/20261126-indices.json. Tests which
change their times/dates are explicitly synthetic; they are not evidence for a
historical correction.

Final index binding now requires quote time and cutoff at or after the maximum
of vendor session end and the independently reviewed exchange cash-close floor.
Ordinary KOSPI/KOSDAQ cash markets close at 15:30, not the competitive block-trade
15:00 deadline. An early vendor end cannot lower the floor. A later vendor end
remains an additional conservative constraint, not official special-session
proof. Original source metadata is not relabeled or rewritten.

Sources checked 2026-11-26:
- KOSPI normal: https://regulation.krx.co.kr/contents/RGL/03/03010100/RGL03010100T1.jsp
- KOSDAQ normal: https://regulation.krx.co.kr/contents/RGL/03/03020401/RGL03020401.jsp
- 2026-11-19 KOSPI 16:30: https://kind.krx.co.kr/external/2026/11/05/000141/20261105000216/99303.htm
- 2026-11-19 KOSDAQ 16:30: https://kind.krx.co.kr/external/2026/11/05/000145/20261104001218/70780.htm

The two official notices explicitly identify the date and regular cash-session
hours. The reviewed immutable special-date table is separate from vendor/LLM
input; no caller, environment override, timestamp or provider label authorizes a
special close. Malformed special entries, invalid dates, unknown calendar years,
weekends and existing holidays return no close evidence. The existing local
calendar is reused as an additional deny gate via a side-effect-free export; its
CLI behavior and the workflow's mandatory authoritative synced-calendar gate are
unchanged. No second feed or replacement calendar is introduced. Future official
special-session changes require a reviewed update; this is not automatic notice
discovery. Unsupported calendar coverage remains conservative omission.

Regression covers captured real quotes and exact 15:30, rejected 15:00/15:20/
15:29:59, cutoff before close, the official 16:30 exception, non-trading/unknown
dates, later vendor constraints and actual final app JSON plus both HTML paths.
Existing daily-bar/sign/percentage checks remain in force. Existing public cards,
including November 19, and raw research remain byte-identical. No dispatch,
schedule, historical regeneration or unrelated holiday-content change is made.
