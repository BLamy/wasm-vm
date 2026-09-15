# E5.5-T03w worker submission

This task adds generated FADD.S/FMUL.S through the existing integer-only
software backend, with precise mode/FS faults and the existing FP handoff.
Independent literal cases exposed a pre-existing missing OF flag on finite
saturation. The shared F32 add/mul wrapper now corrects that flag using the
same backend widened for a rare overflow classification, preserving the
original rounded result. Other arithmetic families and formats are unchanged.

Worker native and private/shared WASM self-checks pass 17,664 arithmetic cases,
80 control/fault/same-source cases and three real run-loop fault prefixes.
The corpus register/flags FNV is `0303711512bb0d8a`; this is not a full-machine
hash. A separate 45-case backend fixture proves both true overflow and nearby
non-overflow saturation, plus after-rounding tininess. Frozen-head results,
actual browser proof, desktop outcome and deployment identities are recorded
below when their commands complete.

The existing live rv64uf-p-fadd ELF contains addition and multiplication; the
demo capability reuses it. A separate built-page ELF executes the new JIT path,
spills its actual FPR results and reads fcsr into integer registers for direct
assertions, alongside interpreter and RAM-digest comparisons.

The actual physical input trial is the desktop acceptance. Passing instruction
checks alone does not establish desktop responsiveness.

## Frozen source, scoped repairs and actual artifact

Runtime source and promoted fixtures: `357dd1a0f9f984747f3f92ad83b0ae556e6689f5`.
The original recorded focused submission retained two failures: an obsolete
native admission test still rejected FADD.S, and the browser harness timed out
selecting T03w because the generated task data was stale. All arithmetic test
processes and the actual ELF/suite/capability checks before that selector passed.
`d64b037b362b36490d58b82663a448ac0532b025` fixes only the cfg(test) admission
contrast (FADD accepted, FSUB rejected) and generated roadmap data. The repaired
native library passes 33/33; the repeated built-browser command exits 0. See
`affected-commands.json`, `repair-commands.json` and their complete logs.

The rebuild changed WASM bytes despite the test-only Rust source diff. The
attempted byte-identity assertion failed; no equivalence is claimed and the
cause is not established. `repair-build-identity.json` records both hashes.
Final browser, physical trial, public and pristine-clone evidence bind the new
WASM SHA-256 `e84c821a12fa5782e229614b9bd3f5a37713e7f3e4d1d38788ac194a7a039db4`
(1,597,144 bytes; service-worker version `9fa7d34efaee`).

## Actual built browser

`browser-final/report.json` records an actual ELF executing 4,000 instructions,
3,649 via JIT, 30 host entries, 1,894 direct entries and 1,864 links. The ELF SHA-256 is
`3cbc3c840f9b093d5043e998802a41a6089fad4efcf5128b11ce99e77abb58b8`.
The RAM-only SHA-256 is
`7583c9377630eaa1af54c7eafb05d5ba5d3c9f708e5d6f1ef47cbd45dc6debf8`;
this is not a full architectural-state digest. The harness separately compares
exposed X registers, actual FPR spills, fflags/frm/FS and runtime statistics
against the interpreter and literal expected values. Earlier and repaired
browser guest execution records are identical, although artifact hashes differ.
The live suite passes 127/127 with zero page/console/HTTP errors; the arithmetic
capability is live 1/1 and the T03w task detail is visible. Root and fresh critic
inspected the screenshots. Revealing the legacy capability container is limited
to its explicitly labeled inspection image; no hooks enter the physical trial.

Independent proof adds 8,832 literal/all-initial-flag cases (FNV 17621813032391191516),
3,072 seeded cases including 1,488 illegal exits (FNV 12643572604827571813),
11 CSR/prefix/fault cases (FNV 12235252711163659176), and 1,024 instrumented generated
module cases with 540 legal calls and zero illegal helper calls. Mixed integer /
arithmetic / integer modules execute the actual shifted indices. Direct chains,
fuel exits, real memory growth and later faults run in private/shared executors.
One wrong literal fails before restoration passes in an isolated test copy.
See the sibling `fp-arithmetic-verifier` directory for independent predictions,
receipts, hunk classification and retained harness setup failures.

## Actual physical input failed

Command: `node tools/verify/omarchy-desktop-services.mjs
 evidence/omarchy-profile/fp-arithmetic-r1/physical-input`.
The unchanged R3 snapshot/delta/kernel/chunks and original 1280x800 mode,
clock divider 64, batch cap 24, cache 4096, threshold 512 and disabled recycling are
bound in the receipt. No builds or heavy verifier work overlapped the trial.
Startup readiness took 130,448 ms. Enter completed at 21:44:39.143Z and the
unchanged 120,000 ms deadline was 21:46:39.143Z; failure was recorded one ms later.
All 128 events were trusted and accepted, with zero dropped/pending/rejected input.
Thirteen independent reads returned 75 and one was pending; no nonce was read.
The generated nonce was never injected through serial. Frames remained 2→2;
`failure.png` is byte-identical to `desktop.png` and shows only the actual Foot
prompt. The guest retired 1,658,987,905→2,901,938,899 instructions and its final
JIT share was 0.4198681355489146. These counters do not establish a speedup.
The owned browser closed normally without a watchdog.

Full report SHA-256:
`c20fe7de2adb79c581367529f52d942b535d43f4d15e257dfa58cb4ee8cc8b85`.
`physical-summary.json` links the outcome and counters. T03q remains pending;
T03x plans the measured 985,870 integer-to-float conversion boundary and cannot
start until independent T03w verification.

## Publication

`cloudflare-deploy.log` records deployment to
https://52209836.wasm-vm.pages.dev and https://wasm-vm.pages.dev.
`cloudflare-public.json` records eight TLS-verified exact-byte checks of WASM,
glue, roadmap and app document across both origins. The critic independently
fetched all eight assets. This publishes arithmetic capability without claiming
a responsive desktop. Deployment manifest commit: `f494ef51`.

## Full local gauntlet

`record-submission.py ci` ran `make -k ci` at `f494ef51` from
21:50:52 to 21:59:08 UTC, with no competing task-owned build or desktop trial.
It exited 2; `ci-commands.json` and `ci.log` retain the complete result.
The failures are the existing macOS seccomp syscall/type compilation errors,
all-feature `live_blocks` / `fetch_phys` dead-code lints, the stale default
WASM VIRTIO_RNG reserved-section assertion, the zicsr-stub test build's missing
supervisor/SBI methods, and the determinism scanner matching a test-only clock.
`unchanged-gate-files.json` binds the seven underlying unchanged files to the
verified T03v parent. The unrelated failing test bodies in `jit_browser.rs`
are outside the arithmetic closure diff. No full-gauntlet pass is claimed.

The worker arithmetic WASM tests pass 2/2 and the critic arithmetic tests pass
6/6 within that run. Native real-CSR ISA compliance passes 128/128, and the
uncontended performance smoke passes at 25.3 MIPS against its 15 MIPS floor.

## Final pristine clone

`run-cold.py` cloned `f494ef51de1763d3a7f78d11f96d6afc50fc46e0` into
`/private/tmp/wasm-vm-fp-arithmetic-cold-cxcibws5/repo` with a clean working tree
and scrubbed Rust/Cargo environment. `make web-dist` and `make verify-E5_5-T03w`
both exited 0, finishing at 22:09:30 UTC. The rebuilt WASM is byte-identical
to the committed and public artifact. The cold tests preserve the worker and
critic receipts; the built guest again retires 3,649/4,000 instructions via
JIT with the same registers, spilled results and RAM-only digest. The live
suite passes 127/127 with zero errors. Root inspected the cold screenshots.
`cold/report.json`, `cold/acceptance.log` and `cold/browser/` retain the proof.
