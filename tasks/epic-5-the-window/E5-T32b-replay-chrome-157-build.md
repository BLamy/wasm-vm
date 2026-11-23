---
id: E5-T32b
epic: 5
title: Build optimized Replay Chrome 157 for riscv64 with the unbundled driver
priority: 0.3852
status: in-progress
depends_on: [E5-T32a]
estimate: S
risk: high
capstone: false
---

## Boundary

Carry the minimum RISC-V port patches forward from the 108 port (E0-T34) onto 157,
preferring upstream riscv64 support where it now exists (V8, seccomp sandbox,
crashpad). Generate the unbundled-driver `record_replay_driver.{cc,h}`. Optimized
release: no symbols, `is_official_build`-equivalent codegen, ThinLTO if it links
within the VM's RAM, otherwise recorded as a measured exclusion.

## Deterministic acceptance

`chrome --version` reports 157.0.8103.0 under QEMU riscv64; headless `--dump-dom`
of `tools/chromium/guest/smoke.html` reports JS, WASM and canvas success with the
renderer sandbox enabled; `tools/privacy/check-no-replay-backend.py` passes on the
packaged output tree.

## Adversarial verification

High risk: confirm the sandbox is actually engaged (seccomp state of the renderer),
prove no driver bytes are embedded, and diff the port patches against the 108
record to justify each carried hunk.

## Verification log

(empty)

### 2026-11-23 — worker — build round 1 result (progress note, not a claim)

Round 1 (`ninja -k 0 chrome chrome_sandbox`) compiled about 56k of 94,084 steps
under Rosetta, with 23 failed steps and 37,952 left. All 23 failures had one cause:
Chromium's clang `raw-ptr-plugin` (`check-raw-ref-fields`, on by default in
non-official builds) rejects native reference fields in Replay's own
`base/deterministic_containers.h` (iterator `vector_`) and `base/record_replay.h`
(`AutoLock/AutoUnlockMaybeEventsDisallowed::lock_`). The fix is Chromium's
documented `RAW_PTR_EXCLUSION` annotation on those four fields
(`tools/chromium/157/patches/replay-rawref-exclusions.patch`). It is lint only, with
no codegen change. Turning the check off in GN args was rejected because it would
change every compile command and rebuild every finished step. Before patching,
ninja's deps log showed 0 and 4 compiled dependents of those headers. All 23 failed
objects then compiled cleanly, and round 2 started for the remaining steps.
