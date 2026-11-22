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
