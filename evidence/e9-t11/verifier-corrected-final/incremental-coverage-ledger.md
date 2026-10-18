# Corrected E9-T11 incremental coverage ledger

Runtime head: `e14e4312b9ee8df73b93646c944bf64a2f0db875`.
Previous verifier commit: `efddcc0a261056933b562b70f74c4742dc640465`.
Final worker/cold/public identity checks passed; the final verdict is verified.

The unchanged HELD ledger remains authoritative for the unchanged code and proof
boundaries. Its SHA-256 is bound in `orientation.json`; the original failed JIT
recording is retained as historical failed evidence. It is not relabelled as corrected
proof. The old red promoted regression is also the sabotage control for the new
dispatch guard: it fails without the guard and must pass with it.

The repair adds one executable hunk, `session_clock.rs:663-673`. The actual Wasmtime
boundary harness observes both sides of its runtime condition:

- Source active, RTC armed: record quantums 1, 6, and 7 all emit exactly the three
  polls at 384, 385, and 386. The values 123, 124, and 125 fire and disarm the alarm.
  All nine record/replay pairs have byte-identical tapes and final frames and zero
  live replay calls. The independent decoder checks native CPU arithmetic, CLINT
  phase, the RTC alarm flags, session position, and source cursor.
- Source active, RTC disarmed: the actual guest RTC-read fallback case records
  exactly four reads at 390, 398, 406, and 414, executes four compiled blocks during
  the captured span, and replays under quantums 1 and 8 with no live RTC calls.
- Transition from armed to disarmed: after the third poll, the quantum-6 and
  quantum-7 record runs execute 13 and 3 actual compiled blocks, respectively.
  Final transition/retired are 468/468 with alarm fired and cursor 3. This checks
  that the guard releases when the source no longer polls.
- Source inactive, RTC armed: the control performs six provider polls and six
  actual compiled blocks over the original 36-transition span. The guard does not
  alter ordinary uncaptured execution.

The native selected byte-budget regression has active source capture with no RTC;
its corrected authoritative run supplies the remaining `Option::None` condition
coverage. Worker and cold native logs show the promoted byte-budget test passing. The option combinators are standard library control flow, not a separate
device behavior.

Other changed files in the repair are declarative or generated: the replay contract
binds the changed source digest, the design text states the dispatch rule, the task
log records semantic rework, the acceptance source inventory authenticates the
promoted JIT test, and web build identities/assets are regenerated. Their sufficiency
check is exact source/asset identity plus successful corrected acceptance/public
proof, rather than runtime branch coverage.

No additional runtime hunk is unclassified. The existing 224-hunk, native-line and
JavaScript coverage classifications carry forward for unchanged executable code.
