---
id: E6-T12e7
epic: 6
title: Validate and execute structured TGSI unsigned conditionals
priority: 525.0269907
status: in-progress
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

## Execution notes

The dependency was independently verified at
`26ed74a31e0ee3c1d43b4e174c8096d67898d920`. This remains one atomic S/high
conditional-semantics boundary: grammar, unsigned execution and sound joins must
be implemented together. Use an eight-level bounded structure stack, with heap
snapshots rather than full profile copies on the fixed Wasm stack. Preserve the
existing instruction, source text, output and memory limits.

Both syntactic predecessors must establish each subsequently consumed lane; the
initial implementation does not infer predicate correlations or eliminate known-
condition branches. Canonical physical float shadows carry values across joins;
initialization and ordinary-output authority meet by intersection, while surviving
numeric bank dependencies combine by union. Validate optional branch targets
against their actual matching ELSE/ENDIF, and reject an unfinished structure at END.

Use two explicit closed profiles: raw-bits-v8 for unconditional structured stages,
raw-bits-v9 for structured stages requiring the existing finite-bank contract.
Both existing raw-bits-v7 and new raw-bits-v9 require their complete domain record;
no new profile may make that obligation optional. Preserve older full compiler
results and original captured hashes. The consumer change is limited to recognizing
these two compiler profiles under the existing unchanged bank-validation rules.

Read-only capture analysis found four original fragment bodies with 25 UIF,
23 ELSE and 25 ENDIF instructions, maximum depth seven. All four remain PRECISE
rejections. The 5a243fc7 body reads TEMP6 at instruction109 although the outer false
path does not define it; a6143f11 reads TEMP2 at instructions49/60 after a one-sided
write and TEMP15 at instruction169 after another. Authored witnesses must reject
these conservative initialization gaps. Do not initialize missing lanes to zero,
strip PRECISE, or claim full original-corpus admission; sound path-sensitive
handling of those original gaps belongs to the later full-corpus boundary.

Production negotiation stays off while this isolated compiler/shared-renderer
slice is proved. Positive hardware fixtures must use actual unmodified compiler
results and decoded commands. Preserve predecessor proof oracles with explicit
successor adapters, avoiding fabricated historical receipts. Record one final
frozen-source pristine-clone proof, then a separate adversarial verifier verdict.

## Verification log

(empty)
