# November 27 source-boundary repair

Production c151f4354b2ffbe8716442137f3880948532b21a collected the headline
`[e마켓클로징] 코스피 4711 강보합···금리 인상에 상승폭 반납 | - 시사저널e`.
Removing ` - 시사저널e` left a terminal pipe in local direction evidence. That
fragment flowed through marketEventSummary and the morning event guard, which
appended `가 확인돼`. The same pipe appeared in strategy, rainy weather and major
news. The exact candidate, original signal and writer output are captured in the
regression fixture; original production research remains unchanged.

Headline cleaning now removes terminal ASCII/fullwidth pipe boundaries after
source-name removal and before local evidence extraction or summary synthesis.
Internal separators remain intact. The strategy uses `등의 흐름이 나타나`, avoiding
an unconditional particle attached to a headline. A recursive field-level final
gate rejects dangling boundaries after all rewrites (including injected `|가
확인돼`, terminal pipe, and pipe before the next slash-separated event). The
writer quality failure list includes this diagnostic.

Only the still-current 2026-11-27 08:30 card's three affected fields are corrected
in both web HTML files and latest app JSON. The strategy now reads `상승폭 반납
등의 흐름이 나타나`; the other two fields simply lose the leftover pipe. Original
meaning, source, timestamps, existing closing cards, raw research, schedules and
unrelated US holiday/cash/futures content are preserved. No generation dispatch.

Tests exercise the exact source -> local signal -> final artifact preparation ->
app JSON / both workflow HTML paths, including previously cached dirty signals,
a post-rewrite reintroduction, fullwidth/repeated boundaries and valid internal
separators. HTTP verification checks actual published artifacts; it does not
verify a native app's local cache refresh.
