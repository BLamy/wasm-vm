---
id: E3-T25a
epic: 3
title: Typed error taxonomy and fault-injection contract
priority: 325.1
status: pending
depends_on: [E3-T10, E3-T20d]
estimate: S
risk: medium
capstone: false
---

## Goal
Give every detectable network, chunk, and storage failure one typed policy and one deterministic
injection point before implementing recovery state machines.

## Deliverables
- `docs/design/error-taxonomy.md` mapping detection, guest effect, UI surface, and recovery owner.
- A single typed `ErrorSurface` contract with no ad-hoc alert/console-only alternatives.
- Bounded development-only fault-injection hooks and a table-to-test completeness checker.

## Acceptance criteria
- [ ] `make verify-E3-T25a` proves every taxonomy row maps to one type, injection hook, and named
  test target, with no orphan code or documentation row.
- [ ] Production builds cannot activate injection hooks.
- [ ] Existing errors entering the covered seams are routed through the typed contract.

## Adversarial verification
Audit bare alerts/console errors, add an undocumented variant, forge injection flags in production,
and trigger simultaneous types. Any unrouted error, ambiguous owner, production fault hook, or
taxonomy/test mismatch refutes.

## Verification log
(empty)
