# E5-T26e adversarial audit — submitted head `7fd0fa6d`

## Evidence integrity and gates

- Worker evidence digest HELD: `evidence/e5-t26e/native-final.json` SHA-256 is
  `bb329cca45cf2e20ae97a81277db033388432a1a352437e82bfaf8d50dcd7ad0`.
- The exact scrubbed `make verify-E5-T26e` command passed in the existing worktree
  (`scrubbed-gate.log:1-92`) and from a pristine `git archive` of the submitted head
  (`cold-exact-head-gate.log:164-257`).
- The evidence-only verifier harness passed six tests (`attack-harness.log:5-13`). It covered all
  component refusals, all missing sections, malformed/forward envelopes, all zero/over-limit host
  and guest dimensions, native and letterbox plans, viewport/commit/missing-repair refusals,
  cross-tag report metadata, agent-drop cleanup, and a bounded clean retry.

## Predictions

- HELD — ordinary successful ordering is GPU → input → sound → agent → viewport → commit. Native
  and changed-host letterbox reports retain the GPU-provided `1280x720` scanout
  (`src/lib.rs:193-219`).
- HELD — GPU/input/sound refusal, agent drop, viewport refusal, malformed and forward envelopes,
  invalid host/guest dimensions, missing sections, and commit refusal route through clear then cold
  fallback; no later callback is invoked (`src/lib.rs:158-190,222-335`).
- HELD — when fallback actually resets state, an agent-drop attempt followed by a valid attempt on
  the same coordinator/backend is clean and increments the epoch to two (`src/lib.rs:287-310`).
- FAILED — full repair is not a precondition to live commit. The coordinator invokes `commit()` at
  `crates/core/src/desktop_restore.rs:359-367` and only afterwards inspects
  `full_repair_frame` at lines 368-375. The submitted backend itself sets `committed = true` before
  returning that Boolean (`crates/core/src/desktop_restore_tests.rs:123-131`), while its fallback
  does not clear `committed` (lines 134-142). The verifier reproduced an error return with
  `live_committed == true` after the final `cold` callback (`src/lib.rs:358-374`; passing attack at
  `attack-harness.log:7`).
- FAILED — success is a bare callback attestation, not tied to publication. A backend returning
  `Ok(full_repair_frame: true)` without publishing any live state produces an `Ok` report, no
  fallback, and `live_committed == false` (`src/lib.rs:339-356`; passing attack at
  `attack-harness.log:6`). This is the symmetric false-success hole in the same callback shape.

## Production-composition sufficiency

`git grep -n -E 'DesktopRestore(Coordinator|Backend)|desktop_restore' 7fd0fa6d -- crates web Makefile`
found the coordinator only in its module, its unit-test backend, the `lib.rs` export, and the Make
target. There is no production `DesktopRestoreBackend` implementation or call site. The gate runs
the coordinator mocks and GPU/input/sound codec tests as separate commands
(`scrubbed-gate.log:8-87`); it never passes real component payloads through one composed
transaction. This matters because the existing component restore functions mutate their supplied
live state at their own commit points (GPU `snapshot.rs:263-273`, input `snapshot.rs:234-269`, sound
`snapshot.rs:366+`) and no submitted adapter demonstrates detached cross-device staging.

Classification: NEEDS EVIDENCE after semantic repair. Add a concrete native backend/integration
test that stages the actual T26b–d codecs plus agent and viewport state, then proves one commit and
rollback/cold state across each refusal. E5-T26f's browser round-trip remains out of scope.

## Changed-hunk coverage

- `Makefile:1-8,1087-1106` — executed in both scrubbed runs; HELD.
- `crates/core/src/lib.rs:35` — compiled by native tests and no-default-features wasm build; HELD.
- `crates/core/src/desktop_restore.rs:1-399` — every behavior-bearing branch was exercised by the
  worker gate or verifier harness: parse error/success, host validation, four missing sections,
  three component refusals, absent/invalid/valid scanout, agent/viewport/commit refusals,
  native/letterbox, missing/full repair, report fields, and abort cleanup. Derives, constants,
  documentation, and the `2^64` epoch wrap edge are WAIVED as declarative or infeasible and not part
  of the acceptance claim.
- `crates/core/src/desktop_restore_tests.rs:1-357` — all seven tests ran. The test-only
  `refuse_commit` branch at lines 125-127 is DEAD in the submitted suite; the verifier exercised the
  public coordinator's commit-refusal branch independently. The `unknown` fake-backend arm at lines
  69-74 is WAIVED because the coordinator passes only the three reserved device tags.
- Production adapter/call-site hunk — ABSENT, therefore the real cross-device composition claim is
  unexercised rather than covered by the separate component suites.

## Verdict

`VERDICT: refuted`. The ordinary coordinator branches behave as predicted, but the commit/effects
contract can report failure after publication or success without publication, and the submitted
tests contain the first half-restored state while calling it a clean fallback. No production
adapter closes the contract or proves real cross-device composition.

SUITE: no test promoted into the permanent gate while the semantic contract is refuted. The
evidence-only harness is retained as the worker's reproducer.
