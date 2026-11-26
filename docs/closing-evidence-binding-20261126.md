# Closing-row evidence binding

The writer's KOSPI/KOSDAQ strings are no longer authoritative for post-market
output. The existing Yahoo daily-chart collector preserves a small evidence
record from its response: symbol, exchange timezone, regular-session start/end,
quote time/price, daily bar time/close, previous daily bar time/close. No new feed,
credential, calendar rule or schedule is introduced. `status: delayed` remains
unchanged; this code does not relabel it as official exchange data.

Binding requires the requested KST trade date, a completed regular session,
quote time at/after that session end and at/before the information cutoff, one
aligned daily bar, the previous day's bar, matching quote/bar price and coherent
normalized percentage. Values and signs are formatted from those bars, never
from writer output. A plain timestamp, delayed status, Npay date-only row,
headline or writer assertion is insufficient. Missing/inconsistent evidence
produces the existing-schema string `정규장 종가 수치 미제공`; it never substitutes
a previous card or previous-day number. App and HTML share this final artifact.
The upstream holiday/date gate remains unchanged.

All post-market string fields (including sector themes, summary, outlook and
checklists) now use the same individual-stock percentage check. Existing trusted
stockCloseEvidence must identify the stock and same-day official regular-close
record, and the text's signed percentage/direction must match. Approximate/grouped
rates and conflicting signs are removed. No stock collector is added: the current
unsupported path conservatively omits stock rate claims. Those optional records
are trusted collector inputs, not LLM-supplied proof; URL/status labels alone do
not authenticate arbitrary external data.

Final contextual quality checks detect unbound closing copy. Placeholder failures
are retained rather than washed away by neutralization. The production artifact
writer repeats final preparation before writing report.json and HTML. Integration
tests run the real collector normalizer and artifact writer in a temporary cwd,
then execute the workflow's local copies to both website entry files and app JSON.
No generated artifact, historical edition, publication run, or schedule is changed
by this code-only patch. Existing cards remain untouched.
