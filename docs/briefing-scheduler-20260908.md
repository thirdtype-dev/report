# Briefing scheduler hardening — 2026-09-08

## Implemented

- Workflow requests freeze a KST trading date and phase; explicit requests use run name `briefing:YYYY-MM-DD:phase`. Phase-only legacy callers remain accepted for the same-day publication window.
- Regular pre-market runs must remain between 08:00 and noon KST; post-market runs between 16:00 and midnight. Revalidate before generation, commit and each actual push. Historical post-market backfill still requires an exact 16:00 KST cutoff within 48 hours.
- Under the shared publication concurrency lock, fetch current main and skip generation when a complete matching slot exists. Duplicate requests may still be accepted/queued, but they do not regenerate an already committed slot.
- Both publish and recovery require actual public HTML with exact date, phase, time, structured body and no placeholders. Script/style/comment templates and numeric-encoded placeholders cannot satisfy publication checks.
- Recovery follows the matching workflow through terminal state, propagates failures, and verifies Pages. Dispatch HTTP 204 alone is never completion.
- HTTP calls include cancellation and hard deadlines through body reads; success received after an observation deadline is rejected. Publisher has 18 minutes overall and 3 minutes for public propagation; recovery has 25 minutes overall and a 23-minute internal budget.
- Add missing 2026 substitute holidays and reject invalid dates/unknown calendar years for publication.
- Serial regression tests now run in CI on briefing source/workflow changes.

## Remaining operational work (not represented as fixed)

GitHub scheduled events remain best effort: delayed/dropped event creation cannot be repaired by a workflow date guard. Existing Cloud Scheduler jobs are the primary trigger, but current retryConfig, attemptDeadline and exact job schedules require authenticated GCP readback. Reconcile recovery deadlines with those jobs before claiming timely recovery.

The Signal server changes require a Cloud Run deployment. They use public HTML verification and explicit slot names with a 240-second observer, preserving room in the previously configured 300-second HTTP request budget. A timeout returns non-success and the next retry follows the existing explicit slot; longer Actions/recovery observers own final completion. This session has no available GCP authentication, so repository source publication is not runtime deployment proof.

The known static 2026 calendars are aligned. Signal still adds its GCS-synced calendar and manual holidays; report still uses static/manual holidays. A common calendar authority and stale-calendar failure handling remain required to eliminate temporary-holiday divergence. Unsupported-year rejection alone does not resolve this risk.

Cloud runtime rollback anchors and IAM/secret boundaries are recorded in Signal HANDOFF.md; re-read live state before deployment. Do not expose private admin routes or credentials publicly.
