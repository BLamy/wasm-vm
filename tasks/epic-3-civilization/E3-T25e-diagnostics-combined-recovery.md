---
id: E3-T25e
epic: 3
title: Secret-free diagnostics and combined recovery proof
priority: 325.5
status: pending
depends_on: [E3-T25b, E3-T25c, E3-T25d, E3-T22]
estimate: S
risk: high
capstone: false
---

## Goal
Export useful secret-free diagnostics and prove simultaneous recovery surfaces cannot deadlock or
leak sensitive guest/provider data.

## Deliverables
- A bounded logs/metrics JSON diagnostics bundle with central redaction.
- A combined browser matrix covering provider loss, chunk pause, storage failure, and paste input.
- An audit enforcing taxonomy coverage and forbidden data classes.

## Acceptance criteria
- [ ] `make verify-E3-T25e` completes the combined failure matrix and every recovery returns to one
  responsive machine without duplicated guest work.
- [ ] Diagnostics contain no auth key, relay token, clipboard text, guest file bytes, or reusable
  tailnet state.
- [ ] Bundle size and in-memory log retention remain within documented bounds under flapping.

## Adversarial verification
Combine all failure orders while a paste and network transfer are active, search exported/raw logs
for planted secrets, and flap for two minutes. Any deadlock, replay, unbounded diagnostics, missing
taxonomy row, or sensitive data recovery refutes.

## Verification log
(empty)
