---
id: E5-T12a
epic: 5
title: generated physical keyboard code table and coverage oracle
priority: 512.1
status: verified
depends_on: [E5-T11c]
estimate: S
risk: medium
capstone: false
---

## Goal

Create the single generated mapping from W3C `KeyboardEvent.code` physical identities to the
T11 keyboard's Linux evdev codes, with a checked-in source table and an exhaustive PC-105 coverage
oracle. Layout remains in the guest keymap; this slice only defines physical identity.

## Deliverables

- `web/src/input/keymap.ts` and its checked-in data source/generator, mapping every mainstream
  PC-105 `KeyboardEvent.code` to the corresponding evdev code or an explicit unmapped result.
- A deterministic test using the W3C code fixture that rejects duplicate evdev assignments where
  the physical table is expected to be bijective and flags missing mainstream codes.
- Named constants/fixtures for edge keys such as `KeyA`, `KeyY`, `Backquote`, `IntlBackslash`,
  `AltRight`, `MetaLeft`, `NumpadEnter`, and `ContextMenu`.

## Acceptance criteria

- [ ] Every PC-105 code in the checked-in W3C fixture is mapped or explicitly listed as unmapped;
      no mainstream code silently falls through.
- [ ] `KeyA` maps to evdev `KEY_A` (30), `KeyY` maps to `KEY_Y`, and the punctuation, modifier,
      function, navigation, and numpad edge entries match the Linux input-code fixture.
- [ ] The table test is deterministic and passes from a clean checkout with no generated output
      hidden outside the repository.

## Adversarial verification

Delete one mapping and add a duplicate code in a scratch copy; the oracle must fail with the
missing/duplicate identity named. Exercise `ContextMenu`, `IntlBackslash`, `NumpadEnter`, and
`F24`; any mainstream code that is neither mapped nor explicitly documented is a finding.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `f177fa1` adds the checked-in W3C PC-105 physical-code fixture,
the JSON evdev source table, and `tools/gen-keymap.mjs`. The generator validates duplicate
physical identities, duplicate evdev assignments, missing/extra fixture rows, and explicit
reasons for any future unmapped row before emitting byte-identical `web/src/input/keymap.ts`
and the no-bundler browser projection `web/src/input/keymap.js`. The module exports the lookup,
coverage oracle, and named edge fixtures.

The frozen-head recording ran `node tools/gen-keymap.mjs --check`,
`node --test web/tests/keymap.test.mjs`, and `npm run test:keymap --prefix web`: 10 tests passed,
0 failed. The same recording ran the scratch-copy attacks: deleting `ContextMenu`, appending a
duplicate `KeyA` identity, and assigning `KeyA` the existing `KeyY` evdev code; each was rejected
with the named diagnostic. Output SHA-256 is
`1c5f34216a3bd40334cb5a2bcaf538eb732be78ab8c297740377bd08ef7a4d12`.

Evidence: `evidence/e5-t12a/keymap-2026-09-03.json`, including the fixture/source/generated
digests and exact edge-code assertions. This slice is a non-wired table/tooling layer; DOM event
normalization and browser capture proof remain owned by E5-T12b and E5-T12c.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Coverage — HELD.** Predicted every code in the checked-in W3C fixture would have exactly one
  source row; the oracle observes 119 fixture codes and 119 source rows, with no missing or extra
  identities. Evidence: `evidence/e5-t12a/keymap-2026-09-03.json`, fixture SHA-256
  `6a17d7494bfc7c27f181294dc1893176236531ad5320fe9e75e4d93e40cd243b` and source SHA-256
  `73312315ec4741b7914cf5a21ef638938684f5bc8fb23076bc702686c7fdcc73`.
- **Physical evdev identity — HELD.** Predicted the table would preserve the named letter,
  punctuation, modifier, function, navigation, and numpad identities; direct lookups observe
  `KeyA=30`, `KeyY=21`, `Backquote=41`, `IntlBackslash=86`, `AltRight=100`, `MetaLeft=125`,
  `NumpadEnter=96`, `ContextMenu=127`, and `F24=194`. The generated module digests match byte-for-
  byte for `keymap.ts` and `keymap.js` (`e6a3e893fadd7d288b6eabd4d59c01930498cee7923a682e9ae5d614ec939ada`).
- **Adversarial oracle — HELD.** Predicted a deleted `ContextMenu` row, appended duplicate `KeyA`
  identity, and duplicate evdev code 21 would each be rejected with the affected identity named;
  the scratch-copy run rejects all three. The permanent test also rejects an undocumented unmapped
  row. Evidence output SHA-256:
  `1c5f34216a3bd40334cb5a2bcaf538eb732be78ab8c297740377bd08ef7a4d12`.
- **Diff coverage and integrity — HELD.** The verifier reran the generator check and five-test
  suite at the post-evidence head; every changed source, generator, generated projection, fixture,
  and test path is read or executed, and `git diff --check` passes. This non-wired table slice has
  no browser or deployment claim, so no WebKit/independent-machine run is applicable.
- **SUITE — HELD.** The checked-in JSON source, W3C fixture, generator, generated projections, and
  deterministic Node test are the permanent proof artifacts.

Commands: `node tools/gen-keymap.mjs --check`; `node --test web/tests/keymap.test.mjs`;
`npm run test:keymap --prefix web`; `git diff --check`.
