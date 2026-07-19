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
The VM degrades, it does not die: a dropped Tailscale Worker/session or relay connection
mid-operation produces normal TCP/UDP error semantics in the guest plus policy-safe recovery
for future flows; chunk
fetch failures pause-and-retry rather than corrupt; storage failures pause the VM with a
comprehensible, actionable dialog. Every failure the stack can detect has exactly one
user-visible story.

## Context
Inventory-driven task: enumerate the failure seams and give each a policy. (1) Active network
provider drops: Tailscale Worker/control/session loss and relay WS loss both fail in-flight
guest flows normally; provider-specific reconnect uses bounded exponential backoff, status
shows offline/reconnecting/online, and new guest connects fail fast rather than queueing.
Restore Tailscale from persisted IPN state or refresh the relay token as appropriate, but
never silently switch providers around an ACL denial/revocation. (2) Chunk fetch permanent
failure (T02's retries exhausted) mid-run: pausing the
whole VM on a demand-miss is correct (the guest is blocked on that read anyway) — pause,
banner with retry/details, auto-resume on success; the same seam feeds the offline case
from T24. (3) Storage: T10 defined quota; this covers the rest — backend write errors,
OPFS handle loss, IDB `InvalidStateError` after eviction — mapped to the pause dialog with
distinct causes and a "download diagnostics" button. Define an `ErrorSurface` taxonomy in
one module so new code can't invent ad-hoc alerts; a console-only error is a bug here.

## Deliverables
- `docs/design/error-taxonomy.md`: the seam inventory, per-failure policy table
  (detection → guest-visible effect → UI surface → recovery path).
- Tailscale Worker/session and `WsConnector` reconnect state machines + one status indicator +
  fail-fast-while-down semantics + IPN restoration/relay-token refresh integration, without
  automatic identity-changing fallback.
- VM pause/resume plumbing for blocking storage/chunk errors (pause emulation loop,
  preserve device state, resume idempotently) + the dialog component with cause-specific
  text and actions.
- Diagnostics bundle export (logs ring buffer + metrics snapshot).
- Fault-injection hooks (dev flag) for every seam in the taxonomy, used by the E2E tests.

## Acceptance criteria
- [ ] Kill the active Tailscale Worker/control connection during `apk add python3`: apk fails
      within 10 s; status shows reconnecting; restore it; retry succeeds from persisted IPN
      state with no duplicate node or page reload. Repeat in forced-relay mode and verify token
      refresh. Neither case silently switches provider.
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
Combine failures: drop the active Tailscale/relay provider *and* inject a chunk failure while a paste (T22) is
mid-flight — recovery order must not deadlock (pause holding the paste pipeline while the
dialog needs the main thread is the suspected bug; prove or refute). Flap each provider at 0.5 Hz
for two minutes during continuous guest `wget` loops — backoff must cap, memory must not
grow, and the indicator must not desync from reality. Pause via chunk failure, then close
the dialog with the keyboard/Escape — an un-resumable zombie VM refutes. Diff the taxonomy
doc against `grep`-audit of the codebase for `alert(`/bare `console.error` in error paths —
an unrouted error surface refutes. Verify reconnect doesn't replay: no duplicated guest TCP
data after a mid-transfer drop (provider-side byte accounting). Revoke the Tailscale node
while relay is healthy and prove recovery fails closed until the user explicitly changes policy.

## Verification log
(empty)
