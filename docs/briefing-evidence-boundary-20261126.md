# November 26 correction and final copy boundary

The scoped correction changes the existing November 25 16:00 / November 26
08:30 HTML cards and the current app JSON, preserving original timestamps and
raw research. Sources: USTR November 25 proposed Section 301 actions release,
and Samsung Securities November 25 closing report (2026112515475228K_02_01.pdf).
The November 26 card retains the then-upcoming BOK decision. It does not import
later results. The November 25 card does not import the later USTR announcement.

The generation boundary now runs after event guards and again before rendering.
Numeric/truncated/policy-stage headline fragments cannot become factual closing
or policy assertions through the guard. Unproven tariff stages are replaced by
neutral monitoring copy. Quantitative closing summary prose is omitted in favor
of the separate structured index rows. Stock percentage claims require separate,
same-day official regular-close records for each named stock; otherwise the
numerical claim is omitted. Public HTML validation also rejects editorial debris.

`officialEvents` and `stockCloseEvidence` are trusted collector input contracts,
not LLM output or a means to infer facts from headline text. They are optional;
current collection does not populate them. No API/authentication/license setup
is introduced. Missing records take the conservative branch. Official events
require an explicit timezone-bearing publication timestamp at/before the report
cutoff; effective claims additionally require effectiveAt at/before cutoff.
Stock records require name, per-stock changePercent, tradingDate, regular_close
session, official_close status, marketTime, and an exchange source URL. Domain
checks alone do not authenticate an externally supplied record; a future collector
must preserve original exchange response provenance and market-session semantics.
This change does not establish new KRX redistribution rights or certify intraday
quotes as official closes. It does not deploy the expired November 19 exception.

Validation: boundary-time, missing/late source, proposal vs effect, previous-day
vs intraday percentages, grouped vs per-stock rates, repeated guard preparation,
final HTML and full existing regression suite. No actual generation dispatch is
used as a test. Native installed app caching cannot be verified from the public
WebView URL and app JSON alone.
