---
id: E6-T12e7
epic: 6
title: Validate and execute structured TGSI unsigned conditionals
priority: 525.0269907
status: pending
depends_on: [E6-T12e6b]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit only the inventoried UIF, ELSE and ENDIF structured conditional family,
including validated optional branch labels. Define a finite nesting limit and
validate complete structure before upstream translation. UIF uses the TGSI
unsigned x-lane condition; it must not reinterpret the operand as a float test.
Carry declared/initialized lane facts through actual control-flow predecessors;
one branch's write cannot establish a value on the other branch. Check captured
dataflow before choosing a validator that would silently initialize or alter
undefined/conditionally defined lanes. No generic IF, CONT or loops are added.

Conditional numeric authority from finite-bank contracts must join soundly with
initialization and ordinary-output authority. An unexecuted branch cannot donate
facts; every potentially selected bank word stays within the enforced domain.

## Deterministic acceptance

`make verify-E6-T12e7` executes independently authored nested true/false/else
fixtures with distinguishable per-lane pixels, noncanonical integer true values,
and both sides of every tested branch. Require native/Wasm parity, complete
structural rejection tests and unchanged original-hash outcomes (12 accepted,
seven PRECISE rejected). Do not strip PRECISE to make captured control-flow tests.
Record exact-head and clean-clone evidence.

## Adversarial verification

Attack dangling/duplicate ELSE, unmatched delimiters, wrong labels, depth limits,
END inside unfinished control, y-only truthiness, joins with one-sided writes
and uninitialized predicate lanes. Sabotage branch polarity or lane-fact merging
and require a literal pixel or deterministic rejection oracle to fail.

## Verification log

(empty)
