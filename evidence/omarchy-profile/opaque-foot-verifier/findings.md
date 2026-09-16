# Independent findings — E5.5-T03af

## F1: positive machine classification skips physical proof when `typedAt` is missing

**Prediction:** A successful machine-input classification requires completed
physical input, including the typed command, Enter and ordered acknowledged events.

**FAILED at frozen head `20737fb7bd9051286629beafc2a4f15ae839ee64`.** The conditional
at `tools/verify/omarchy-input-audit.mjs:74` skips completion checks when
`keyboard.typedAt` is absent. The classification at line 100 still returns
`machineAcceptance: true` when `report.result` has the success label and a timely
nonce/fresh-frame fixture is supplied. All earlier event/call checks accept empty
arrays.

An explicitly synthetic control was accepted. Removing `keyboard.typedAt`, all DOM
key events and all `sendKeyboardEvent`/`syncKeyboard` calls and acknowledgments
still produced `machineAcceptance: true`. This is not a fabricated product result:
the fixture files explicitly set `productEvidence: false` and exist only to test
the acceptance guard. The outer wrapper continues to set `desktopAcceptance:
false` pending human image inspection.

Reproduction (no guest/browser or source mutation):

`node evidence/omarchy-profile/opaque-foot-verifier/input-audit-test.mjs`

Evidence: `input-audit-test.json` → `missingPhysicalAttack.acceptedAsMachine`
is `true`; `input-audit-recheck.log` repeats the result. The script identifies the
unchanged input-audit helper hash and source fixture digest. The late-wire attack
and stale-frame attack in the same bounded fixture are correctly rejected.

**Demand:** Require complete physical-input metadata and sequence whenever the
report claims machine success or a verified nonce, then retain this missing-proof
fixture as a rejection check. Existing real negative recordings remain valid;
this is an auditor correction and does not call for a runtime rebuild or a new
guest run.

### Fixed recheck — HELD

Worker correction `ed7edad7e1bdfa627809c93dc11a4838311180b5` changes only the
auditor and its tests. The independent original control still passes, while the
same missing-physical candidate now throws `input success requires a completed
physical sequence`. `input-audit-fixed.json` and `input-audit-fixed.log` record
this separate recheck. The two original reproductions remain byte-identical at
`input-audit-test.json`, `input-audit-test.log`, `input-audit-recheck.log` and their
`before-correction` copies. `seal-audit.json` confirms preservation. The independent
focused tests pass 12/12. F1 is resolved; no runtime or recorded guest bytes changed.
