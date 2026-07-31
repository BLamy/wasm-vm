---
id: E3-T26d
epic: 3
title: Frozen deployed security audit
priority: 326.4
status: pending
depends_on: [E3-T26b, E3-T26c]
estimate: S
risk: high
capstone: false
---

## Goal
Run one exact-head deployed audit proving isolation, CSP, credential hygiene, and all protected app
flows hold together in cold, warm, and offline states.

## Deliverables
- One pristine-profile deployed acceptance target with response, network, storage, and violation
  evidence.
- A hostile subresource/XSS/iframe/cache matrix against the frozen production configuration.
- A security checklist linked to deterministic regression targets and deployment docs.

## Acceptance criteria
- [ ] `make verify-E3-T26d` passes from a pristine clone/profile online and offline with exact
  headers, isolation, zero unexpected violations, and all protected E2E flows green.
- [ ] Hostile scripts/connects/frames and missing-CORP assets are blocked and surfaced through
  E3-T25 rather than hanging the VM.
- [ ] The final storage/network/diagnostics audit recovers no reusable credential or guest data.

## Adversarial verification
Repeat on a second browser engine, inject XSS and missing headers, race service-worker versions,
probe framing and worker messages, and inspect every persisted/exported object. Any production-only
bypass, silent boot hang, credential recovery, or undocumented manual exception refutes.

## Verification log
(empty)
