# BOK decision context at the final copy boundary

The current production collector supplies news candidates, not an authenticated
BOK decision record with exact official text and proven availability by the
briefing cutoff. A headline, RSS timestamp, source label or official-looking URL
cannot establish that record. No BOK `officialEvents` producer exists. Therefore
this patch deliberately does not add a synthetic proof contract or claim to
preserve authenticated numerical decisions in production.

Newly generated copy mentioning the Bank of Korea/Monetary Policy Board and its
base/policy rate is converted to an explicit macro-specific withholding statement
before the generic stock-percentage check. This also handles percent-free stage
claims such as “will be announced”, “unchanged” or “undecided”. Without verified
availability, neither a morning schedule nor a closing result is asserted. The
rule is independent of a hardcoded meeting date/hour: no guessed 09:50 official
publication time, broad percentage exemption or artificial provider status.
Mixed stock-and-rate strings are withheld as a whole; their stock rates cannot
ride through a macro exception. Unrelated stock and verified index-close behavior
is unchanged.

Limitation: even a factually correct rate decision supplied only as writer/RSS
text is withheld. Restoring exact rates or time-specific upcoming/result text
requires a separately supported collector of the official decision, its trade/
meeting date and evidence of availability at/before cutoff. That integration is
not implemented here. Tests before/at/after a candidate news cutoff intentionally
all withhold; they do not claim to test a working official-source integration.
Stale/future/spoofed/missing source signals cannot authorize a decision.

The contextual final quality gate rejects unprepared rate copy for new morning
and closing generation. Context-free validation of historical cards is unchanged;
correct earlier upcoming text is not retrospectively invalidated. Actual final
artifact-writer tests cover app JSON and the workflow copies to both HTML paths,
with repository artifacts checked byte-for-byte unchanged. No cards, raw research,
schedules, recovery rules, authentication or publication dispatch are modified.

## Entity/event aliases and stage conjugations

The boundary recognizes 한국은행/한은/금통위/금융통화위원회 and
기준금리/정책금리/plain 금리 결정·동결·인상·인하 contexts. Deposit,
loan, bond and other non-policy rate terms are excluded from the policy event
match. A rate context also needs an asserted stage or number: neutral commentary
about impacts or checking an official original/publication time remains intact.
Announcement claims share an action-stem matcher for 발표/공개 and Korean
active/passive/future forms (including 발표될 예정, 발표됩니다, 발표됐습니다).
Existing tariff-stage handling uses the same matcher; no feed or evidence
contract changes. Both morning and closing contextual gates catch unbound tariff
claims reintroduced after preparation. Context-free historical-card checks are
unchanged. Tables cover aliases, conjugations, unrelated rate commentary, final
app/HTML artifacts and supported pre-cutoff proposed tariff wording. This remains
a conservative fallback, not official rate-number collection.
