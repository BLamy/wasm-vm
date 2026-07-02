---
id: E3-T25
epic: 3
title: Error recovery - network drops and storage failures surfaced sanely
priority: 325
status: pending
depends_on: [E3-T10, E3-T20]
estimate: M
capstone: false
---

## Goal
The VM degrades, it does not die: a dropped relay/network connection mid-operation produces
normal TCP error semantics in the guest plus automatic reconnection for future flows; chunk
fetch failures pause-and-retry rather than corrupt; storage failures pause the VM with a
comprehensible, actionable dialog. Every failure the stack can detect has exactly one
user-visible story.

## Context
Inventory-driven task: enumerate the failure seams and give each a policy. (1) Relay WS
drops: in-flight guest TCP flows get RST (guests handle that — curl retries work); the
`WsConnector` reconnects with exponential backoff + jitter (1 s → 30 s cap), a status
indicator shows offline/reconnecting/online, and new guest connects during the gap fail
fast (ECONNREFUSED-equivalent) instead of queueing. Re-fetch the auth token (T19) on
reconnect. (2) Chunk fetch permanent failure (T02's retries exhausted) mid-run: pausing the
whole VM on a demand-miss is correct (the guest is blocked on that read anyway) — pause,
banner with retry/details, auto-resume on success; the same seam feeds the offline case
from T24. (3) Storage: T10 defined quota; this covers the rest — backend write errors,
OPFS handle loss, IDB `InvalidStateError` after eviction — mapped to the pause dialog with
distinct causes and a "download diagnostics" button. Define an `ErrorSurface` taxonomy in
one module so new code can't invent ad-hoc alerts; a console-only error is a bug here.

## Deliverables
- `docs/design/error-taxonomy.md`: the seam inventory, per-failure policy table
  (detection → guest-visible effect → UI surface → recovery path).
- `WsConnector` reconnect state machine + status indicator + fail-fast-while-down
  semantics + token refresh integration.
- VM pause/resume plumbing for blocking storage/chunk errors (pause emulation loop,
  preserve device state, resume idempotently) + the dialog component with cause-specific
  text and actions.
- Diagnostics bundle export (logs ring buffer + metrics snapshot).
- Fault-injection hooks (dev flag) for every seam in the taxonomy, used by the E2E tests.

## Acceptance criteria
- [ ] Kill the relay during `apk add python3`: apk fails with a download error within 10 s;
      indicator shows reconnecting; restart the relay; re-run `apk add` succeeds with no
      page reload (token refreshed automatically).
- [ ] Fault-inject permanent chunk failure during a guest `find /usr`: VM pauses with the
      chunk-error dialog; clearing the fault + retry resumes and `find` completes
      correctly (no EIO leaked to the guest for a transient infra failure).
- [ ] Fault-inject a backend write error: dialog appears before any guest write is falsely
      acked (cross-check with T08 instrumentation); choosing retry after clearing works.
- [ ] Every taxonomy row has a passing automated test via its injection hook (table in
      the doc cross-references test names — no orphan rows).
- [ ] Diagnostics bundle downloads as JSON and contains no token, no clipboard contents,
      no guest file data.

## Adversarial verification
Combine failures: drop the relay *and* inject a chunk failure while a paste (T22) is
mid-flight — recovery order must not deadlock (pause holding the paste pipeline while the
dialog needs the main thread is the suspected bug; prove or refute). Flap the relay at 0.5 Hz
for two minutes during continuous guest `wget` loops — backoff must cap, memory must not
grow, and the indicator must not desync from reality. Pause via chunk failure, then close
the dialog with the keyboard/Escape — an un-resumable zombie VM refutes. Diff the taxonomy
doc against `grep`-audit of the codebase for `alert(`/bare `console.error` in error paths —
an unrouted error surface refutes. Verify reconnect doesn't replay: no duplicated guest TCP
data after a mid-transfer drop (server-side byte accounting).

## Verification log
(empty)
