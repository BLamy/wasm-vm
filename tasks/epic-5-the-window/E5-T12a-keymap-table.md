---
id: E5-T12a
epic: 5
title: generated physical keyboard code table and coverage oracle
priority: 512.1
status: pending
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

(empty)
