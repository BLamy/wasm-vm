# Frozen diff coverage map

Reviewed scope: af6b4bf4..179b8fd04e716a24a7b15091b3f7b0de0a356dfb. Runtime
matches 8c3f4e14477292d329783d0eee7451a63d0644fe exactly. Final evidence was
handed off in cab17ae7. Required final checks below are fulfilled by acceptance.log
lines 90-93, 808-822, 824-859 and the exhaustive final-audit.json hash/sample audit.

| Changed hunk | Execution / disposition |
| --- | --- |
| core gpu/mod.rs:367-371 pending_events | Real built worker odd-mode reads keep EVENT_DISPLAY=1. No writes in getter. T04 set_display/coalescing implementation unchanged; require final two native test passes. |
| wasm/lib.rs:1465-1467 test registration | Compile-time declaration, waived as non-runtime; require all four named wasm tests in final output. |
| wasm/lib.rs:2343-2373 strict setter | A1 real worker accepts 65 odd pairs; rejects NaN, infinity, overflow, zero/-0, fractional, string, boolean, null/undefined, objects/arrays, boxed Number and BigInt in second argument. Final worker covers both positions/extremes and absent/reentrant branches. |
| wasm/lib.rs:2375-2419 stats | A1 independent EDID decode, checksum, clone/alias check, empty resource/null scanout; C3 executes property-error mapping and verifies recovery. Final wasm resource test must cover live/stale resource IDs, dimensions/bytes, absence and both RefCell errors. |
| wasm/display_tests.rs:1-180 | Test-only setup manipulates the actual device map/inner machine to reach states JS cannot construct. Production methods are unchanged under cfg(test); exact asserts, not stdout, prove resource pixels/bytes. Four final named test passes required. |
| web/linux-worker-protocol.js:30-31 | A1 observes actual linux-worker.js module Worker, real WasmLinux, structured-clone reads and stopped RPC rejection. Protocol fixture regression is transport-only supporting proof. |
| web/loader.js:1015-1017 | A1 real worker calls production loader. C1 direct diagnostic exercises main-thread controller. Final worker direct stop must return false/null. |
| web/main.js:1869-1870 | C2 actual active wvmDemo forwards 997x613 to its real controller and reads equal stats. Eight-byte hash-checked fixture, existing startPaused test hook. No guest OS or compositor claim. Final worker also covers pre-boot false/null. |
| web/display-hotplug.js:1-62 | Final worker visible worker UI + C1 direct selection, duplicate start while busy, invalid submit/error/finally, stop/null stats. Fixture hashes are transport integrity checks, not independent semantic oracles. |
| web/display-hotplug.html:1-27 | Declarative markup/style waived from instruction coverage; rendered diagnostic screenshot verifies host-only labels and controls. |
| web/roadmap.js:144 | Declarative partial status/evidence string waived from execution; final demo detail must preserve the host/compositor distinction. |
| web/tests/e4-t32-worker-protocol.test.mjs additions | Mock controller explicitly isolated to protocol plumbing. Actual runtime proof comes from browser and wasm tests, not its constants. Final 25-test suite passes at acceptance.log:850-855. |
| tools/verify/e5-t22a-display-hotplug.mjs:1-146 | Final acceptance must run this file; S1 no-op setter HTTP sabotage causes assertion 1280 !== 1367 at visibleStats width check. Error observers/server failure branches are diagnostic harness safeguards, waived. |
| Makefile:931-935 | Final exact-head make verify-E5-T22a must invoke GPU feature-enabled native, wasm --lib, protocol and browser checks. Recipe declaration/phony lines are metadata. |
| docs/display.md:1-52 | Documentation, waived. Reviewed host-only scope, actual resource accounting, stopped behavior, explicit deferred compositor/deploy milestones. |
| web/dist source mirrors | Require identical Git blob/content hashes for changed HTML/JS source mirrors. Runtime paths executed by browser are deployed copies. |
| web/dist/pkg JS and wasm | Setter/stats exports executed by direct/worker tests; generated error branches include invalid setter and C3 stats error. Final source/wasm hashes must match frozen head. |
| web/dist/pkg *.d.ts | Generated types, waived as non-executable. |
| web/dist/sw.js cache VERSION | Generated cache identity only, waived as metadata. No cache behavior change is claimed. |

## Independent results already recorded

- A1 HELD: odd-mode-result.json records 65 modes with complete EDID snapshots,
  unchanged zero resources, null scanout, errors, and stopped rejection.
- S1 HELD: sabotage-result.json and sabotage.log record the new acceptance
  harness detecting a no-op setter, with original/injected harness digests.
  Initial verifier post-check assumed default width 1024, corrected to actual
  1280; both sabotage attempts failed correctly at the same acceptance assertion.
- C1-C3 HELD: coverage-result.json records direct diagnostic invalid-input UI,
  stats property-error recovery, and active main-wrapper/controller parity.

## Baseline no-fire audit

The full task diff has no changes to crates/core/src/lib.rs,
crates/core/src/dispatch.rs, crates/core/src/hart/mod.rs, or wasm integration
hart tests. The identified dead-code / unused import / collapsible-match sites
are outside the diff. GPU test feature gating is also pre-existing; the final
task command correctly selects gpu-trace. Review final logs for exact failures
and passing scoped alternatives before assigning P7.

No new ignored tests, disabled debug assertions, or test-only production
implementation branches were introduced. The only new cfg registers the test
module for wasm32/non-zicsr-stub. T04 transport semantics are carried forward.

Final source mirrors and all 14 browser binding digests match exact-head blobs.
The two final screenshots were inspected and their digests match browser-proof.
The final clean clone still has no tracked changes; only generated evidence is
untracked. The manifest-staging correction is exercised by final acceptance.

Correction to worker summary: normal wasm regression is NOT wholly green.
regression.log:603-662 records input_queues.rs:91 observing EV_SYN/0/0 instead
of EV_KEY/30/1. The test never constructs WasmLinux or calls this patch's GPU
getter; its input, MMIO, queue modules, lockfile and crate manifest are byte
identical to af6b4bf4 (final-audit.json). This is an additional baseline failure,
not a hotplug refutation, and is explicitly carried in the verifier log.
