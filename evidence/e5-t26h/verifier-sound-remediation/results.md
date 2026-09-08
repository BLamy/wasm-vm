VERDICT: verified

Frozen runtime: `e8850241b686fd497c4ff1589fd31b6ffd0c7cc4`, based on `71dae950`.
Later HEAD `8d594832` changes evidence/task/dist only; the reviewed Makefile, core library, and
audio regression remain byte-identical to the frozen commit.

## Scoped results

- **P1 identity/evidence — HELD.** Frozen SHA-256 values match the worker claim: `lib.rs`
  `eb54ec562944d8e12133e9b6d52401bc8bed7cd316828d13ea74da365587f39d`, audio test
  `1a2fb0343f1b09429dbab00cab67181cb146c3acf2bc7991adb3a670ae7794dc`, and Makefile
  `6ac1c8207232d72a0ebc7491e971210ecb6b69fd9b600487661f086205b1091e`.
  Worker gates hash to the claimed
  `7b7aba1be129f036c2ffbfc4e5428dc3ed566497d0d8820fea73e045bdec2820` and record 125 passing,
  zero failed/ignored checks; the related 21 sound tests hash to
  `449388e12b8fa769f739cf77d26d35744fb0910c76173deee448a06e35d09979`.
- **P2/P3 queue wire order and absent RX — HELD.** Save emits control/event/TX/RX and layout word
  2 (`crates/core/src/lib.rs:2761-2766`); restore assigns queue 2 to TX and queue 3 to RX
  (`:3029-3053`). The regression checks tuple 2 contains the nonzero TX cursor and tuple 3 is
  empty. Whole-machine and desktop-envelope matrices both load when RX is absent.
- **P4/P5/P6 fresh PCM/no replay — HELD.** The independent focused run passes all 32 combinations
  of 480/2048 frames, zero/high source clock, stopped/released stream, RX absent/present, and
  whole-machine/desktop-envelope restore. Every fresh deadline reports seed-1701 bytes,
  `queued=1`, `used=2`, status `0x8000`, while assertions retain zero restore-time fresh-sink
  bytes, unchanged old sink, and the fresh clock. Representative citations:
  `focused-native.log:17-24,57-64,89-96,121-128,137-150`. The representative source/fresh WAV
  hashes also exactly match the worker report:
  `f369083051a2f5b9ed2faf1f8c15286e91d63e9b11b7f0cded9c76fce141d704` and
  `f05ff377271106595e1d35271cd9918fa63e5c29b08f70ca8594dcfca86969d7`.
- **P7 legacy/version refusal atomicity — HELD.** The old unversioned layout, versions
  0/1/3/`u32::MAX`, and 0-3-byte truncated version words all refuse as sound tag 16 while the
  full target snapshot, sound handle, sink, and clock remain unchanged
  (`focused-native.log:15-16,25-39`). Detached prevalidation performs the version read before the
  live commit pass (`crates/core/src/lib.rs:194-216,2941-2947`).
- **P8 novel malformed-v2 atomicity — HELD.** In an exact archive copy, a valid v2 sound section
  was changed only to claim queue-2 TX absent while retaining its nonzero cursor. It returned typed
  sound-tag refusal and preserved the complete target baseline, sound handle, zero sink bytes, and
  fresh clock (`novel-v2-atomicity.log:83-86`). The temporary test is summarized in
  `novel-v2-atomicity.patch`; it is not promoted because the permanent every-section corruption
  and layout-refusal tests already cover this stable parser invariant.
- **P9 headless container v1 — HELD.** The explicit no-sound fixture retains outer format 1,
  restores CPU/RAM into a fresh target, and retires the next instruction; the focused six-test
  target passes (`focused-native.log:4-150`).
- **P10 sabotage — HELD.** In the temporary archive only, restoring the old save order
  control/event/RX/TX made the configured-RX regression fail all eight variants. It reproduced the
  original signature: seed-73 bytes in the fresh sink, `queued=2`, TX used stuck at 1, and status
  `0xffffffff` (`queue-order-sabotage.log:8-54,74`).
- **P11 carry-forward — HELD.** All nine unchanged promoted H tests pass independently
  (`focused-native.log:154-165`), preserving the prior console session fence/stale-HELLO,
  serial/control, input, GPU, CPU/RAM, topology, atomicity, sparse-parser, RNG, and headless results.

## Coverage and clean acceptance

Every remediation hunk executes: exact wire-byte assertions cover order/version emission;
legacy/unknown/truncated cases cover the new version read/refusal; RX-present and RX-absent PCM
matrices cover both restore assignments; the updated Makefile target ran in worker and clean-clone
records. No changed behavior is unexecuted or waived.

One clean local clone detached at exact `e8850241`, with inherited `RUST_LOG` and compiler/Cargo
overrides scrubbed and a separate `/private/tmp` Cargo target, passed `make verify-E5-T26h` and
remained git-clean (`clean-exact-head.log:563`). No browser, WebKit, independent-machine, or rr gate
was run or required for H; E5-T26f owns browser acceptance.

## Verifier artifact digests

- Predictions: `4fc23af9cb127a2df36d4c27b2ee2e8a83b571ba925e6096b007fcdb320626eb`
- Focused native: `1cd687c156e0b1f2db7f3a549b51cd73a4b2f21123d5d2e309daaa894b5e0002`
- Novel v2 atomicity: `0b02d479d8072051fcf0e1f64cce60088713f42dc53d9cdbb80172146425c374`
- Queue-order sabotage: `87ee475dcdc3f20030cbb85319064e212914a602dcf72adda9112247fdbf26b6`
- Clean exact-head acceptance: `8446b698a4bb27edb3dc533a7c8d295889395861ae3731f1f295e94473fa5921`
