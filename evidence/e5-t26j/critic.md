# E5-T26j fresh adversarial critic ledger

Critic: fresh Daybreak Blue session
Activation: `661dc96691e2b42b3d12b00152f505e72058cd99` on
`codex/e5-t26j-icount-divider`
Task risk: high
State: final — verified at evidence head `f5696211245d782cfa0341f4c874b1ed14b3a7da`.

## Scope and constraints

This critic owns only this file. It will not edit implementation, tests, task status,
queue, branches, or commits. Browser work and heavy gates remain deferred until the
coordinator supplies a frozen exact head and evidence. E5-T26j configures deterministic
retirements per `mtime` tick; it does not claim wall-time correctness, a speedup, F
verification, or permission to promote divider 1 as the default.

The source snapshot reviewed on 2026-09-08 was still uncommitted. Relevant tracked-diff
SHA-256 from activation was
`2171df116954d1d69e63aee3f45a5a2fbccbfe7949d5b55b0f603dc3536de686`.
The untracked JS test then hashed
`6cdc8129fd1d126a28aed644d3fbda6097df92f9a28c44000db5db55a30024f2`.
These are orientation anchors, not final evidence; all conclusions must be repeated
against the frozen head.

## Frozen runtime layer

The runtime/dist/F-harness layer is frozen at
`d2eda6857a2d17d19f8c64b037239a675901f2e6`, a direct child of activation
`661dc96691e2b42b3d12b00152f505e72058cd99`. Its activation diff contains exactly
20 files and hashes to
`90d8a8f2452de411837f63595e7cb97c923abce5736f1e3f981a5bade546b808`.
`git diff --check` is clean. The four copied web source files are byte-identical to
their `web/dist` versions. The built WASM is 1,546,368 bytes with SHA-256
`8df0e82c87aa25d39988517b045b42712f8c94d1bec4f0d1db5ed2ab772f0e3a`;
its generated JS and type declarations expose `setICountDivider`. The existing
dist manifests are the same Git blobs before and after this commit and currently
hash to `9e28ead1264e08a806ef7fd3159813163ca26d4caf85071923b20467f3fa35dc`
and `86cd0e8049ca1943848bfe3215d36e53e705cdb986b61d37a6aa2e92d5c27543`.
This authenticates source/build identity but does not substitute for the final
test/ABBA/cold-clone evidence at the later harness head.

## Preliminary source review

No early blocking contradiction was found in the reviewed runtime source.

- `Machine::set_icount_divider` validates the new 1..1024 range, CLINT presence,
  ICount mode, and the saved phase before mutation. Equality returns before either
  phase or divider is written. The only success writes are
  `tick_accum = floor(oldAccum * newDiv / oldDiv)` and `clock_div = newDiv`, with
  the multiply and divide in `u128`.
- The WASM export accepts only a JavaScript numeric primitive that is finite,
  integral, and in range before borrowing the machine. Core incompatibilities are
  returned as errors; there is no coercing fallback.
- `createGuestClockLifecycle` validates explicit input, reads actual ICount state,
  invokes the setter once, reads actual state again, and requires the requested
  divider with unchanged `mtime`. It stores a scalar-only frozen receipt and returns
  fresh copies. The omission branch preserves the prior E5-T26i mode-selection path.
- `startLinuxBoot` validates before its first manifest fetch. The lifecycle call is
  after durable stored-snapshot restore, Alpine RAM restore, and initramfs restore,
  and before scheduler state/pump construction. Thus an explicit value acts on the
  restored divider, while omission does not manufacture divider ten.
- The whole-machine worker forwards raw boot data through structured clone and adds
  only the read-only `icountDividerSelection` RPC. No live divider setter is added to
  the controller method allowlist.
- The desktop query adapter preserves absent versus present-empty values. The F
  diagnostic parser restricts the experiment to reuse mode and divider 1 or 10,
  rejects JIT/residency/profiler/latency/command overrides, keeps `jit=1`, and records
  actual worker clock, receipt, JIT, retirement, cursor/text/audio/PCM, and original
  cap outcomes. The existing `postRestoreStart` and `postRestoreEnd` assignments and
  two-second assertion are not moved or replaced. Divider observations add real RPC
  cost inside the original interval; that makes the experiment conservative and does
  not authorize a timing waiver.
- Existing `CLOCK` resume bytes remain `(tick_accum, clock_div, stimecmp)` with no
  format/version change, and the existing WasmLinux construction default remains
  `enable_clint(10)`.

This review does not yet prove behavior. In particular, no final core/WASM tests,
guest traces, browser artifacts, ABBA records, exact-head hashes, sabotage, or cold
clone have been inspected.

### Unfrozen test-source review

The subsequently appearing Luna test sources were read without executing them.
They materially target the stated boundary: 2,176 small phase/ratio cases
(`16 * (1 + ... + 16)`); exact
next-tick distance; byte-exact same-divider snapshots; pending MTIP/MSIP plus retained
CLINT handle; missing-CLINT/range/wall/invalid-restored-phase refusals; prior dividers
through `u64::MAX`; stored restore followed by one explicit override; busy `rdtime`
trace/digest parity across cache modes; strict real `JsValue` types; production
WasmLinux default ten; a live compiled WASM executor; loader ordering; omission; and
the paired worker receipt. No blocking contradiction was found in those unfrozen
tests. Their pinned digest constants, pass status, WASM execution, sensitivity, and
coverage remain claims until authenticated final records and sabotage are inspected.

The later `tools/verify/e5-t26j-clock-worker.mjs` source was also reviewed without
launching it. It serves the built `web/dist` under isolation headers, constructs the
busy UART/`rdtime` guest from explicit instruction words, and exercises direct and
whole-machine-worker loaders for omitted, 10, and 1. Each arm starts paused, checks
actual state/receipt, resumes, obtains two guest-emitted `rdtime` values, pauses and
checks frozen state, compares final `mtime` with actual scheduler retirements/divider,
and requires a live JIT executor with JIT retirement and chaining. Its report hashes
the built loader, clock adapter, protocol, WASM, and harness and records browser errors.
The source makes no desktop/F timing claim. No blocking contradiction was found; the
actual run, arithmetic inputs, build provenance, uniqueness of the output directory,
and manifest-preservation record remain to be verified after freeze.

The unfrozen ABBA collector was then read in full. It refuses an old checkpoint knob,
pins one exact head and runtime/image/origin binding, creates one new cold sealed
persistent profile, and delegates each 10/1/1/10 arm to a distinct recursive copy of
that seal. Its 5 ms physical-key pacing matches the independently HELD F completion
configuration at `8c892667`; the command remains `sh /tmp/a`, profiling and JIT policy
overrides remain absent, and the original restore-completion T0 and 2000 ms endpoint
are checked directly. The collector accepts only exit zero or the exact retained cap
AssertionError, while requiring cursor, terminal, PCM/audio, restore, actual worker
clock/receipt, JIT, and retirement progress in either case. It labels every output
`acceptance: false` and `fVerified: false`. No early blocker was found in this source;
the final runner tests must still show that altered order, reused profiles, changed
bindings, wrong exits, endpoint drift, or missing functional observations are rejected.

## Pre-evidence predictions

These predictions were written before inspecting final evidence. Each must be marked
`HELD`, `FAILED`, or `NEEDS EVIDENCE` against a concrete artifact and point.

1. **P1 — core admission and atomic refusal.** Dividers 1 and 1024 succeed only with
   an attached CLINT, active ICount mode, and `clock_div > 0` with
   `tick_accum < clock_div`. Zero, 1025, missing CLINT, wall mode, zero old divider,
   and out-of-range old phase return errors with the complete pre-call machine and
   device state unchanged.
2. **P2 — exact no-op.** Calling the core setter with the active divider leaves the
   full observable machine state, including phase, CLINT identity, CLINT registers,
   CSR interrupt state, SBI deadline, and serialized bytes, byte-for-byte unchanged.
3. **P3 — conservative phase mapping.** For every small valid old phase/old/new ratio,
   and for old dividers near `u64::MAX`, the resulting phase equals exactly
   `floor(u128(oldAccum) * u128(newDiv) / u128(oldDiv))`, remains below `newDiv`, and
   neither overflows nor rounds upward.
4. **P4 — architectural invariants.** A successful change preserves `mtime`,
   `mtimecmp`, MSIP, pending/enabled timer and software interrupt state, SBI
   `stimecmp`, CLINT shared-object identity, and unrelated device identity/state.
5. **P5 — next-tick and busy-time behavior.** After rebasing, the first subsequent
   `mtime` increment occurs after exactly `newDiv - newAccum` retirements. Busy guest
   `rdtime` advances according to the selected divider in both interpreter and enabled
   JIT paths without changing retirement results or device ordering.
6. **P6 — unchanged defaults and wire format.** A newly assembled WasmLinux machine
   reports divider 10 and unchanged ICount traces/digests when no option is supplied.
   Snapshot layout/version and all non-clock bytes are unchanged; a round trip retains
   the selected divider and mapped phase exactly.
7. **P7 — strict WASM adapter.** JavaScript `undefined`, `null`, booleans, strings,
   boxed numbers, objects, arrays, BigInt, NaN, infinities, fractions, zero, negatives,
   and values above 1024 are rejected rather than coerced. Numeric 1..1024 reach the
   core once. Missing CLINT and wall conflict surface core refusal with no mutation.
8. **P8 — JS fail-closed boundary.** Exact decimal query strings `1`..`1024` and
   numeric integers pass; alternate spellings, whitespace, signs, exponents, hex,
   leading zeroes, empty/present-null-like values, incompatible modes, and invalid
   types fail before fetch or machine access. Omission alone remains omission.
9. **P9 — restore/override order and failure behavior.** Stored snapshot divider and
   phase are restored first. An explicit divider is then applied once before any guest
   pump; omission preserves the stored divider. Setter/read/postcondition failure
   aborts without mode conversion, retry, default substitution, or execution.
10. **P10 — read-only receipt and worker ownership.** The paired real worker protocol
    receives the raw boot value by structured clone, the owned worker returns actual
    before/after clock state, and callers cannot invoke a live setter. Receipt results
    contain only independent scalar copies; mutating a returned copy or later live
    machine state does not alter receipt history. Live clock reads remain live.
11. **P11 — F harness invariants.** Divider experiments are accepted only as reuse
    runs with exact value 1 or 10. They retain the original `sh /tmp/a` command,
    unprofiled JIT-on repack-off policy, original post-restore T0/T1 assignments, and
    unchanged 2000 ms assertion. The endpoint records actual active divider, stored
    divider 10, immutable selection receipt, increasing `mtime`, and increasing total
    and JIT retirement counters before/after the unchanged interaction.
12. **P12 — authenticated ABBA experiment.** One newly created cold seal is
    cryptographically bound to the final runtime, assets, image, manifest, snapshot,
    browser identity, and profile. Four independent copies run unprofiled in order
    10/1/1/10. Every arm records actual clock/JIT state, timing, cursor, text, command,
    PCM/audio, console/HTTP errors, and success or failure. Negative or marginal
    timings remain valid configuration evidence but do not verify F or change defaults.
13. **P13 — guest/native/WASM evidence.** Final deterministic native and actual-WASM
    records exercise the changed core and adapter paths and bind their traces/digests
    to the frozen source. No rr, WebKit, independent-machine, Actions, or deployment
    artifact is required or implied.
14. **P14 — sabotage sensitivity.** Corrupting one expected phase mapping causes the
    phase test to fail at that case, and breaking one JS forwarding/receipt assertion
    causes the paired protocol test to fail. Restoring source returns both to green.
15. **P15 — exact-head portability and coverage.** One scrubbed pristine clone at the
    frozen exact head passes `make verify-E5-T26j` with no local-file dependency. Every
    changed E5-T26j runtime, WASM, JS, loader, worker, harness, Make/roadmap, and test
    hunk is executed or explicitly and narrowly waived; unrelated concurrent changes
    are excluded from this task's claim.
16. **P16 — actual built loader proof.** The one-shot built-runtime harness completes
    six arms: direct/worker crossed with omitted/10/1. Every arm begins at `mtime=0`,
    omission reports divider 10 with no selection receipt, explicit 10 and 1 report
    immutable before-10/after-request receipts, two real guest-emitted `rdtime` values
    strictly increase, pause freezes the complete reported clock state, and final
    `mtime` equals `floor(actualRetired / activeDivider)` using a safe observed retire
    count. JIT remains installed, chained, and actually retires code. The report binds
    the built loader/adapter/protocol/WASM/harness digests and has zero page, console,
    or HTTP errors. The surrounding build record proves pre-existing dist manifests
    are byte-identical before and after the build except for deliberately generated
    E5-T26j artifacts.

## Incremental evidence results

### P16 — actual built loader proof — HELD at `d2eda685`

The completed local Chromium record is
`evidence/e5-t26j/worker-d2eda685/guest-rdtime.json`, SHA-256
`e3305ea1b8698607f322a92e3d6e63735d23d37d485b0047fac9fb91be47260c`.
Its transcript SHA-256 is
`6d7b7a85d5a6a44c9ec8547618d45e9aecd2c2ec06ec06d457eba0147476d1f5`.
The record names exact head `d2eda6857a2d17d19f8c64b037239a675901f2e6`, Chromium
152.0.7977.76, the narrow non-F claim, and an empty error array. Each embedded
loader/clock/protocol/WASM/harness SHA-256 matches the frozen committed file.

All six ordered arms are present: direct and worker, each with omitted/10/1.
Omission reports actual divider 10 and `selection: null`; explicit 10 and 1 report
before-divider 10, after-divider requested, and unchanged `mtime=0`. Direct arms
retire exactly 6,000,000 instructions and end at `mtime=600000/600000/6000000`;
worker arms retire exactly 5,500,000 and end at
`mtime=550000/550000/5500000`. Thus every final value equals
`floor(actualRetired / activeDivider)`, and divider 1 yields exactly ten times the
ticks of divider 10 for the same backend budget. In every arm `pausedBefore` equals
`final` exactly.

The independently decoded eight-byte little-endian UART samples equal every
recorded guest `rdtime` value and increase within each arm. Each scheduler records
two one-byte inputs and two eight-byte outputs. Direct JIT retirement is 5,998,209
of 6,000,000; worker JIT retirement is 5,498,181 of 5,500,000. Every arm has a real
executor, region and dynamic chaining enabled, profiling timing disabled with zero
timer reads, and `guestRetired` equal to scheduler retirements.

This closes P16 and supports the built-runtime portions of P5, P6, and P10. Those
broader predictions remain open for exhaustive phase/atomicity, snapshot, strict
WASM, receipt-mutation, sabotage, ABBA, and exact-head cold-clone evidence. It is
configuration evidence only; it makes no desktop performance or F claim.

### P13/P15 — scrubbed cold source proof — HELD incrementally

One owned clone at `/private/tmp/e5-t26j-critic.pgE4yQ/repo` was created without
local hardlinks, detached at code-bearing head
`cb283f9b3204f99d0bbc9ad44121c4f5da7b8b6a`, and run with `RUST_LOG`,
`RUSTFLAGS`, `CARGO_HOME`, `CARGO_TARGET_DIR`, and
`CARGO_ENCODED_RUSTFLAGS` unset. `make verify-E5-T26j-runtime` exited 0:
formatting and both Clippy gates passed; 35 native tests passed, including the
100-second 52,800-sample JIT/interpreter/eviction churn; the no-default-feature
wasm32 core build passed; and all 175 selected JavaScript tests passed. The native
divider trace and RAM digests were respectively `4ddc392297ebe1dc` and
`c7d032c22b596d220102600fedf6e5de9e0f7e38487e0367eb4b8a7d4b51f7c4`.

The separately composed scrubbed command
`wasm-pack test --node crates/wasm --test icount_divider --test guest_clock`
then exited 0 with 16/16 tests. This exercised the actual 32-bit WASM boundary,
strict `JsValue` validation, exact same-divider no-op, invalid-state atomicity,
u128 phase mapping, restore-before-explicit-override, live compiled-executor
identity/counters, and the existing guest-clock cases. Its divider trace and RAM
digests exactly matched native. The built WASM remained
`8df0e82c87aa25d39988517b045b42712f8c94d1bec4f0d1db5ed2ab772f0e3a`.

The same clone was advanced—not rerun—to final metadata head
`054bb87f93b490645d5af921207f97af08629113`. The intervening diff contains only
the committed gate/demo transcripts, task log, generated `web/tasks.json`, its
byte-identical dist mirror, and the derived service-worker cache key. E5-T26j is
now present as `in-progress` with the correct dependencies and adversarial text;
both task JSON copies have SHA-256
`a5562e9503daab9db98bc023937946ee0df9cb907d6fde4a33fd5930242dd124`.
No emulator source, JS runtime, or WASM byte changed. The scratch checkout was
restored clean, and every verifier compiler/test process exited before the desktop
measurement arms. This closes the cold deterministic portion of P13/P15; the
final demo and ABBA evidence remain to authenticate.

Durable verifier provenance, streamed-result transcripts, and frozen-input
digests are preserved under `evidence/e5-t26j/verifier/`; see its `README.md` and
`verifier-digests.txt`. The full command stream was not originally redirected, so
the durable cold transcript states that limitation explicitly rather than
misrepresenting a post-hoc summary as a byte-exact raw capture.

### Novel attack and P14 sabotage — HELD

A temporary critic-only deterministic oracle sampled 256 full-width prior
dividers/phases from a fixed LCG seed, selected new dividers across 1..1024, and
for every case independently calculated
`floor(u128(phase) * new / old)`. It required byte-exact snapshot identity except
for the three CLOCK scalars and then retired exactly to the next tick. The focused
native test passed all cases in 0.07 seconds.

Two isolated reversible sabotages were effective. Replacing floor with ceiling in
`Machine::set_icount_divider` made
`all_small_ratios_and_phases_preserve_state_and_land_the_next_tick_exactly` fail
at its snapshot assertion (exit 101). Replacing the desktop query forwarding with
unconditional `undefined` made `web/tests/e5-t26j-icount-divider.test.mjs` fail its
explicit empty-string/raw-value assertion (10 passed, 1 failed; exit 1). The source
and temporary oracle were then removed, and `git diff --exit-code` confirmed the
scratch clone exactly clean at `054bb87f`. P14 is HELD.

The exact temporary oracle source, applicable sabotage patches, observed failure
transcripts, and their SHA-256 manifest are preserved in
`evidence/e5-t26j/verifier/`.

### Demo metadata/runtime composition — HELD at `054bb87f`

The corrected local Chromium demo record reports 126 passed, 0 failed, 126 done,
with empty page and HTTP error arrays. Its roadmap detail contains E5-T26j with
status `in progress`, the exact I/H/T19a dependencies, scoped timer-rate goal,
worker evidence text, and adversarial charter. I visually inspected the captured
page: the E5-T26j detail panel is open beside the completed all-green 126-test ISA
matrix. SHA-256 values are `11f437aab9e9ff67634756fa15c3fc2af6ca52f31e203fb5c6e10b32b6a9b789`
for `demo-054bb87f.log`,
`0daf6b3616163253d79ffc5cd311aad624d4171553b93e5323a780de63ac30dd`
for `demo-suite.json`, and
`fcc34a98415dfd669d769108af98424ea59a4f444b49f898d3f1b7ff5d0596af`
for the inspected PNG. The first pre-refresh roadmap timeout remains retained as
a correctly diagnosed metadata failure; it is not counted as a runtime pass.

## Carried-forward results

The following are not re-litigated unless E5-T26j changes their code/dependency
boundary or evidence digest:

- **E5-T26i HELD:** all 14 clock-mode predictions, authenticated local Chromium
  comparison, pause/restore behavior, conservative JIT path, and unchanged ICount
  trace/digest behavior at runtime
  `84ef07f7f4ec173dc921a1d91a764f538953600fdccfb3af0eed4aaca57617f9`;
  critic report SHA-256
  `256c7faa7c6b449363b75801b051ec3a4b4dd7696a37536671de6508ece8eb84`.
- **E5-T26h HELD:** whole-machine resume/session fence, CPU/RAM/device topology,
  sparse-parser atomicity, console/input/GPU/RNG continuity, and corrected sound queue
  identity. Final clean-clone sound-remediation head was `e8850241`; detailed retained
  evidence is in `evidence/e5-t26h/verifier-sound-remediation/results.md`.
- **E5-T19a HELD:** sound control lifecycle and exact fresh PCM before/after restore at
  runtime `9e8e1c22423f935e2e918a687cc6633e1356869c`; critic report SHA-256
  `081aae089b68b59ee7ca15526e4f9e885d90abfdf9cb4ae54b8fbff526c1d747`.

Prior F functionality independently HELD at `8c892667`, while its unchanged cap
failed at approximately 5.05 seconds. The prior E5-T26i wall-clock arm was also
negative (about 7.5 seconds), and LTO observations were negative or marginal. Those
results constrain claims: E5-T26j may verify only configuration and measurement
integrity unless the unchanged F acceptance itself later passes.

## Final adversarial verdict

VERDICT: verified

- **P1 core admission/atomic refusal — HELD.** Native and actual-WASM
  `missing_clint_and_out_of_range_inputs_are_atomic`,
  `invalid_saved_phases_refuse_before_same_divider_or_any_other_mutation`, and
  `wall_mode_refuses_even_same_divider_without_touching_the_host_anchor` pass in
  `runtime-cb283f9b.log` / `wasm-cb283f9b.log` (SHA-256 `17ae4b…646c` /
  `c80aa0…fe63`). Complete resume bytes remain unchanged after each refusal.
- **P2 exact no-op — HELD.** The shared same-divider test proves byte-exact resume,
  CLINT handle/register, pending MTIP/MSIP, cache/JIT policy, and device identity;
  actual WASM boundary tests independently preserve the same-divider phase.
- **P3 conservative phase — HELD.** The 2,176-case small oracle, full-u128 extreme
  prior-divider cases, and the critic's 256 fixed-seed full-width cases all equal
  floor and land on the exact next tick. The reversible ceiling sabotage fails at
  the snapshot assertion (`verifier/sabotage-phase.log`, exit 101).
- **P4 architectural invariants — HELD.** Shared native/WASM identity tests preserve
  `mtime`, `mtimecmp`, MSIP/MTIP, CSR/SBI deadline, CLINT identity, JIT/cache policy,
  guest memory, and all non-CLOCK resume bytes across a real change.
- **P5 next-tick/busy time — HELD.** Interpreter/cache/JIT cases agree instruction by
  instruction; native and WASM pin identical trace `4ddc392297ebe1dc` and RAM digest
  `c7d032…51f7c4`. The six-case built Chromium proof additionally has exact
  `floor(actualRetired/divider)` mtime and real compiled retirement.
- **P6 defaults/wire — HELD.** Production WasmLinux still constructs ICount divider
  10; the CLOCK payload remains three u64 fields; omission, resume, round-trip, and
  non-clock byte identity pass. Runtime and WASM bytes are unchanged from d2eda685
  through final evidence head f5696211.
- **P7 strict WASM adapter — HELD.** Sixteen actual Node/WASM tests reject all
  coercive/invalid `JsValue` cases and surface core incompatibilities atomically;
  numeric 1..1024 reach the setter. The built WASM SHA-256 is `8df0e82c…f0e3a`.
- **P8 JS fail-closed input — HELD.** The 175-test selected JS gate covers every
  accepted integer/string and rejected spelling/type/mode before access. Dropping
  desktop forwarding makes the dedicated raw-value test fail 10/11 as predicted
  (`verifier/sabotage-forwarding.log`).
- **P9 restore/override ordering — HELD.** Shared resume tests, loader-order tests,
  and all four raw restores show saved divider 10 restored first, explicit selection
  applied once with unchanged receipt `mtime`, and actual selected state before the
  pump/interaction. Omission remains untouched; all error paths abort.
- **P10 read-only receipt/worker ownership — HELD.** JS and real paired-worker tests
  prove raw boot transfer, scalar-copy receipt immutability, live state reads, and no
  controller setter. Tiny direct/worker Chromium arms authenticate both backends.
- **P11 F harness invariants — HELD.** All raw iterations use reuse mode, exact
  10/1/1/10, `sh /tmp/a`, 5 ms physical keys, JIT-on repack-off/cap-24 with entry
  timing disabled, original restore T0/end, and the unchanged 2,000 ms assertion.
  Each endpoint has empty browser/HTTP errors, immutable stored-10 receipt, active
  requested divider, and increasing mtime/guest/JIT counters.
- **P12 authenticated ABBA — HELD.** The new cold record (`fd1c50…c902`) and seal
  (`6e1299…f41`) bind head 054bb87f, independently recomputed runtime `43106f…b5c7`,
  kernel/image/manifest, Chromium 152, profile `901b20…6da`, and decoded 2,626,928-byte
  snapshot `82edb9…248a`. Four distinct profile copies produce raw hashes matching
  `comparison.json` (`1a58e7…9d35`) and the full transcript (`483284…fb05`). Every
  screenshot was visually inspected and every arm records restored CRC, cursor,
  terminal success, released buttons, attached non-silent PCM, and exact cap failure.
- **P13 guest/native/WASM evidence — HELD.** Scrubbed native, JS, wasm32 build, and
  actual-WASM components all pass with matching guest digests. Approved rr, WebKit,
  independent-machine, Actions, and deployment waivers are honored.
- **P14 sabotage — HELD.** Both required isolated faults are detected; exact patches,
  outputs, oracle source, provenance, and SHA-256 manifests are durable in
  `evidence/e5-t26j/verifier/`. Scratch source was restored clean.
- **P15 portability/coverage — HELD incrementally.** One non-hardlinked scrubbed clone
  passed the 35-native/175-JS runtime target and 16 actual-WASM tests at code head
  cb283f9b, then advanced cleanly through metadata 054bb87f and evidence-only
  f5696211 without rerunning unchanged gates. The corrected demo passes 126/126 with
  empty errors and visibly includes J. This is the repo-prescribed incremental
  composition, not a duplicate desktop seal.
- **P16 built-loader proof — HELD (carried).** The previously authenticated six
  direct/worker omitted/10/1 cases remain bound to unchanged runtime bytes and prove
  exact mtime arithmetic, pause freeze, worker receipt, JIT execution/chaining, and
  empty errors (`worker-d2eda685/guest-rdtime.json`, SHA-256 `e3305e…260c`).

### Diff coverage and suite disposition

- **Executed:** the core setter and core/WASM tests run natively and under actual
  wasm32; the strict WASM export runs under WASM and built Chromium; guest-clock,
  loader ordering, worker protocol/receipt, and desktop query hunks run in the 175 JS
  gate plus tiny/full Chromium; F diagnostic endpoint/error-array changes and the
  collector run in their unit tests and all four raw arms; Make recipes run in the
  scrubbed clone; roadmap/task metadata and source/dist runtime copies run in the
  corrected 126-test demo or built-runtime proof.
- **Waived:** generated TypeScript declarations are interface-only mirrors; the
  service-worker cache-key change is derived build metadata; task prose, committed
  transcripts, PNGs, and verifier reports are evidence rather than executable code.
  Source/dist JS copies are byte-identical, and the actual generated WASM executes.
- **Excluded:** concurrent `evidence/e5-t26f/build-screen/**` additions are unrelated
  records with no E5-T26j runtime hunk or claim.
- **SUITE:** retain the committed deterministic core/WASM/JS tests, tiny built-loader
  proof, ABBA collector tests, and `make verify-E5-T26j`. The critic's 256-case oracle
  is archived as evidence rather than promoted because the committed exhaustive and
  extreme suites already cover the stable semantic boundary.

### Scope outcome and remaining observations

Divider 10 mean interaction time is 5,133.270 ms; divider 1 mean is 9,450.975 ms,
4,317.705 ms (84.112%) slower in this bounded ABBA. All four children fail only the
unchanged two-second cap, so **E5-T26f remains unverified** and divider 1 must not be
promoted. Recovered ALSA underruns appear in some screenshots; zero-XRUN playback was
not claimed. Results are local Chromium only under the explicit platform waivers.
No source refutation, evidence gap, dead E5-T26j hunk, or additional task blocker
remains.
