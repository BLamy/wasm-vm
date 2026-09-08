# E5-T26k — fresh critic preflight

Independent critic, never K implementer. Read the full task and AGENTS.md, then
the current runtime/WASM/web/admission/driver diff against
`a3792366dcd36a3d5dc083b8b99166381329849d`, including new modules, before opening
worker evidence. Runtime/JS are reported frozen; Make and small harness tests are
still finishing. This is preflight only, not verification. Only this file is
writable. No browser, heavy Cargo/build, commit or task status change.

## Falsifiable predictions before evidence

All predictions start NEEDS EVIDENCE. Static corroboration below will not be
represented as recorded execution. Unchanged F functional and architectural
results carry HELD; their old runtime seal cannot prove the new K bytes.

1. **Strict bounded selection.** WASM accepts primitive numeric 4096/16384 only.
   NaN/infinities/fractions/strings/boxed numbers/arrays/null/undefined/other and
   oversized values reject before any mutation. URL/loader exact decimal strings
   are parsed explicitly, not passed through JavaScript coercion at the WASM
   boundary. Unsupported or empty query selections fail before boot work.
2. **No-op and actual reporting.** Omission does not call the setter or resize;
   same actual capacity leaves decoded cursor/discovery/compiled handles and
   counters untouched. Reporting reads real core slot count, including the
   retained unrestricted pathological test-only path, not requested option data.
3. **Coherent real resize.** A changed supported size uses the existing coherent
   resize path and clears decoded/discovery/compiled state and stale handles,
   while architectural registers, RAM, time/devices remain equivalent. Aliased
   code, page/DMA invalidation, hostile same-page stores and PMP transitions must
   not reuse stale instructions at either supported size. No snapshot wire change.
4. **Reset/restore and pre-pump.** Default remains 4096. Both cold and stored
   restore apply explicit selection only after initial restore candidates settle
   and before any guest pump; later runtime restore/reset preserves host capacity
   appropriately while invalidating stale execution state. Missing methods,
   unsupported reported capacity or ineffective setters abort outside permissive
   JIT fallback. The whole-worker option/stat path must reach the owned machine.
5. **Isolated diagnostic.** The new flag requires resident reuse, exact labels,
   and no profiler/command/pacing/clock/divider/JIT/residency/COMPLETE overrides.
   Quiet scratch admission remains closed. Actual endpoint records must show
   4096/16384, executor present, repack-off/24, ICount divider 10, chaining retained,
   unprofiled timing and safe progressing counters. No request echo substitutes.
6. **Original event boundary.** Actual first restore completion remains T0;
   physical `play` at 5-ms edges, focus/cursor, conditional successful wait and
   fresh positive PCM precede the unchanged 2000-ms cap. Before observations are
   inside the original interval; after observations follow frozen PCM/end.
   Sequential JIT/clock RPCs are not atomic or exact timed-window measurements.
   Bad raw endpoints remain recorded and abort; non-cap child failures cannot be
   accepted as performance arms.
7. **One matched new-runtime experiment.** A newly authenticated cold seal—not a
   rebound old F seal—feeds independent 4096/16384/16384/4096 copies. Runtime,
   image/helper/profile/snapshot and browser/command settings match all four;
   actual capacity/counter/input/audio/CRC/timing and every failure remain intact.
   Either outcome is admissible for K's experiment; neither implies F verified,
   a default change, generalized speedup or any deadline/FPS waiver.

Later frozen-head work, not run now: affected recorded native/WASM/browser gates,
one bounded novel selection/coherence attack and isolated regression sabotage,
then the single coordinated pristine-clone proof. No repeated unrelated suites.

## Scoped source review — preflight complete

**No concrete pre-cold blocker found in the inspected sources.** This is not a
verified runtime/evidence verdict: no worker native/WASM recordings, new browser
state, timing results or gate logs were inspected, and no tests/builds were run.
The seven predictions still require the planned evidence. Make and test changes
that arrived during review are pinned below, not assumed to be the final commit.

- P1/P2: `crates/wasm/src/lib.rs:3007` uses `JsValue::as_f64` plus exact equality
  before taking mutable machine access; no numeric coercion or truncated cast
  admits other values. `crates/core/src/lib.rs:995` rejects unsupported sizes before
  mutation and calls the old resize function only when actual slot count differs.
  `dispatch.rs:156` reports `slots.len()`, and `jit_stats_object` reads that getter.
  Default construction at core `lib.rs:841` remains `1 << 12`. The unrestricted
  legacy resize path is not newly exposed through URL or worker setter RPC.
- P3: actual resize delegates to existing `set_block_cache_capacity` at core
  `lib.rs:1007`: replaces decoded storage, clears cursor/counters, resets discovery,
  invalidates the executor and clears obsolete write-log entries. No instruction,
  key/probe/replacement, permission, device or snapshot-codec hunk changed.
  New native tests inspect live pointers/cursors/discovery/device identity and
  byte-identical resume blobs, aliases/logged host writes, PMP interior denial and
  hostile next-op patch trace parity at both sizes. These are assertions awaiting
  recordings, not observed passes. The alias test's logged host store covers the
  DMA invalidation seam, not a new full device-DMA execution claim.
- P4: `web/decoded-cache.js:2` accepts only numeric or exact decimal-string labels;
  omission returns before any machine access. Its apply helper checks both APIs,
  reads actual capacity, skips a same-size setter, and verifies a changed result.
  `web/loader.js:290` validates before fetch/construction; `:802` applies after the
  durable/Alpine/initramfs restore candidates and outside JIT's catch, before
  `runTick`/`runChunk`. Failure propagates to the outer fatal boot path. Existing
  core `load_resume` (`lib.rs:3271`) flushes rather than reconstructs the cache,
  retaining host capacity; existing cache reset/toggle does likewise. No new
  capacity field is serialized. The native reset test is cache-toggle coverage,
  not a claim that a newly constructed machine inherits another machine's size.
- P4 reporting/forwarding: desktop passes raw query values in boot options;
  existing host `dataOpts` and protocol boot spread forward them unchanged. The
  existing `jitStats` RPC returns the machine getter, not an echoed option.
  New web tests execute the actual extracted restore block and linked host/worker
  protocol with machine stubs, including five restore routes, omission, missing
  API, ineffective setter and post-reply mutation. They are control-flow/transport
  tests; actual WASM and built Chromium remain necessary. The three new WASM
  fixtures require real compiled blocks/JIT retirement, test rejection/no-op,
  coherent resize, byte/digest/clock preservation and restore of warmed targets.
- P5/P6: `decodedCacheRequested` is resident-reuse-only and refuses every listed
  override, including empty values. Quiet scratch adds an explicit refusal. The
  proper runner adds only the capacity query and two observers; before is after
  original T0, after follows immediate PCM and frozen end. The literal 2000-ms
  assertion is unchanged. `recordDecodedCache` performs sequential awaited
  JIT/clock RPCs, checks actual capacity/policy/clock and safe progressing counters,
  retains arrived bad samples and rethrows. The collector checks original error,
  command/input/CRC/PCM/error arrays and derives elapsed from the original fields.
  It does not replace guest completion with first PCM or subtract observer time.
- P7: the new driver defaults to a new headless cold profile, emits only capacity
  selection across ABBA, scrubs inherited F/K/compiler flags, retains per-arm logs,
  refuses output reuse, and compares runtime/profile/snapshot/prepared bindings.
  Its optional `E5_T26K_CHECKPOINT` skips creation, not authentication: the proper
  runner still enforces the seal's runtime/browser/image bindings. For final K
  evidence, omission creates the required new seal; any separately supplied seal
  must be that new-runtime checkpoint, never old F bytes. Source-hash invocation
  records and raw failed children must be retained alongside the aggregate.

### Coverage limits and next bounded work

Read all new native (7), WASM (3), web (11), observer/helper (6) and driver (3)
test definitions plus the quiet-guard delta. These counts describe source tests,
not rerun successes. Helper collector fixtures deliberately adapt the old F raw
record with synthetic capacity endpoints; they cannot prove K actual capacity.
Driver setup tests stub files/hashes/processes, and loop tests inspect source.
Actual new cold/ABBA records must supply their missing execution proof. The
current Make target schedules affected native/WASM/plumbing gates, web-dist and
the new driver; demo/bundle and final-clone records remain coordinator work.

One later bounded novel case: retain a pending logged patch to the currently
cached code page across explicit same-size selection, then execute and require
the patched instruction, not a stale cursor/compiled path. One isolated sabotage
will remove the real-resize executor invalidation and require the compiled-state
regression to fail. Neither is run against shared source. Await the exact final
freeze/gate evidence before those checks and the one pristine clone.

No unrelated H/I/J/T19a/F proof was reopened. No old seal is promoted to K, no
performance outcome is assumed, and no default/deadline/FPS change is approved.

## Inspected source SHA-256

Repo-relative paths; mechanically checked against the files at preflight close.
These bind the inspected worktree snapshot, not a final committed release.

| File | SHA-256 |
| --- | --- |
| tasks/epic-5-the-window/E5-T26k-browser-decoded-cache-capacity.md | 293586263ed9922b2bb9d4928bb282786d0e558a73f0b1573d0d288d72ac0d78 |
| crates/core/src/dispatch.rs | 5e6ccdd33f9dc9c948dde6e8daa4b69d8f008330169cdecbdfb3356b3d6dc04d |
| crates/core/src/lib.rs | 7f8c72c28cd51afaf44834fd809e9781ea6c27c6d8f6f2f97f1452bb77f9791a |
| crates/core/src/decoded_cache_capacity_tests.rs | 4310fd52f368169a2da9d6ad2acc41743e413bfc9ece892dc7a13c2cb2223c93 |
| crates/wasm/src/lib.rs | 3e5ae2a970afec8684a8a1759ecd40cb7540f528727727b3070d01da2377421a |
| crates/wasm/tests/decoded_cache_capacity.rs | f3182c4073e307f87a6aa5aa9451c684db4a5412db0dfe43c6ab7d29aedf6156 |
| web/decoded-cache.js | 92eb0ef85b5b2580ef1b574b103993d7969b5f1a5cf9d59b8430e5ab300f06ae |
| web/desktop-terminal.js | dffdc59f878a93aff60ca0b77eb31e60b67b0c94bcb7a238854f7991b2c0b65e |
| web/loader.js | 72de17336aa065c8afeb5cbc126f087761b4c76fb24942ba7c6953b3c6994b79 |
| web/tests/e5-t26k-decoded-cache.test.mjs | 58863929256f3b554bbcc6277877d28ba7e19318ff4223cb9c9e36ad7613880d |
| tools/verify/e5-t26f-browser-roundtrip.mjs | bfcdc06f6d6ec330815d7ad12b7a0c101035a11d50348828fe2d39a7370cb219 |
| tools/verify/e5-t26f-resident-proof.mjs | 28742ad80ee2b8628ae18ffc3d24b02f32a7e9c2d8706ec900bb244e1b548d6c |
| tools/verify/e5-t26f-quiet-text-probe.mjs | 1c38cf75c420bf6dc9b187c6aed59e6d0c838e780c1a06e169157e3b5158f6f4 |
| tools/verify/e5-t26f-quiet-text-probe.test.mjs | 723d9628fa967d539293cfd5d8e9730d51e94e218b49138c66fe359c1c746759 |
| tools/verify/e5-t26k-decoded-cache.mjs | fc6dde980554845fc3d28f5e44dcd0caf0c1659d48b320054a00aeb8e67e9843 |
| tools/verify/e5-t26k-decoded-cache.test.mjs | 2f818c4de6aece104909464e490c53659780d027e1c1e09523aa72ce93cbcd39 |
| tools/verify/e5-t26k-browser-capacity.mjs | 525be610f2300a2ded5450664ea0e0cb219329a97d9abbae60247b0ecc0f4a9e |
| tools/verify/e5-t26k-browser-capacity.test.mjs | fe4488cf0a7103c2c87747ff6e70cf459b1d82b43c596c1890ca7af50583f6de |
| Makefile | 46ffe5ddda2c477897b47aff3c62e237344d15bb91be56b41a73f7dd0d347f2e |
