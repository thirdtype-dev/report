# Briefing writer reliability — 2026-09-21

The market briefing generator keeps the existing model, prompt evidence, phase
output, quality gates, and bounded three-attempt workflow. OpenRouter requests
now require the phase-specific report shape through a strict JSON Schema,
route only to providers that support the request parameters, prefer lower
latency providers, disable reasoning, and cap output at 8192 tokens. Zen keeps
its existing request semantics.

The response path fails closed for empty, malformed, root-null, primitive, or
array reports and for responses truncated with `finish_reason: "length"`.
Those response failures and transient provider error envelopes are retryable;
authentication and other explicit nontransient HTTP errors stop immediately.
Provider bodies, model content, reasoning, and parser payloads are not placed
in errors or logs. Successful OpenRouter responses emit only compact routing,
finish, token-count, and elapsed-time metadata.

Focused coverage includes both phases, strict nested schemas, mocked request
transport, retry-then-success and exhaustion, empty/malformed/truncated
content, HTTP 200 error envelopes, terminal 401 responses, shape validation,
and placeholder quality rejection. Run the focused and complete checks with:

```bash
PATH=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH \
  node --test --test-concurrency=1 tests/market-briefing-quality.test.js tests/briefing-writer.test.js
PATH=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH \
  node --test --test-concurrency=1 tests/*.test.js
```
