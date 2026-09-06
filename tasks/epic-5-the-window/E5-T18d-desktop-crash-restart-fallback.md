---
id: E5-T18d
epic: 5
title: Harden compositor restart and tty1 getty fallback
priority: 518.4
status: in-progress
depends_on: [E5-T18c]
estimate: S
risk: high
capstone: false
---

## Goal

Make compositor failure bounded, observable, and recoverable without hanging init.

## Boundary

This slice owns start-desktop logging, the at-most-three compositor restart policy, serial
kill/config-failure hooks, and the visible tty1 getty fallback. The final symptom playbook and
rebuilt-artifact gauntlet belong to E5-T18e.

## Deliverables

- Hardened start-desktop/init configuration that logs each attempt and crash reason.
- A bounded restart harness for one compositor crash and the three-crash getty fallback.
- A visible tty1 error banner and serial evidence for both recovery outcomes.

## Acceptance criteria

- [ ] Killing the compositor with the local serial test hook causes an automatic restart and a
      timestamped log entry without an init hang.
- [ ] Three bounded crashes stop retrying and leave tty1 at getty with a visible error banner.
- [ ] A broken-config boot exercises the fallback path, preserves the diagnostic log, and does
      not silently claim desktop readiness.

## Verification command

make verify-E5-T18d

## Adversarial verification

Inject the 500 ms seatd delay, remove the video device, delete XDG_RUNTIME_DIR initialization,
and force WLR_RENDERER=gles2 in separate local fixtures. Each case must terminate with its
predicted bounded symptom/log path; no new hang or unbounded restart loop is acceptable.
WebKit and independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This S slice isolates process supervision and the failure boundary needed by the final bring-up
playbook.

### 2026-09-05 — worker — STARTED

Implement bounded compositor supervision, a boot-latched tty1 getty fallback, and local-only
serial failure drills. Reuse the verified desktop package profile; no Omarchy or Epic 6 work
starts in this slice. Final evidence will distinguish a successful restart from stale readiness
and prove repeated failure cannot re-enter an unbounded init/autologin loop.
