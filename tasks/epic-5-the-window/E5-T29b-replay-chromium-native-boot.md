---
id: E5-T29b
epic: 5
title: Cold-boot Replay Chromium on native wasm-vm and capture its image pair
priority: 0.382
status: pending
depends_on: [E5-T29a]
estimate: S
risk: medium
capstone: false
---

## Boundary

Qualify the authenticated candidate on wasm-vm's actual CPU and browser device
layout. Use the existing Linux kernel, JIT, sandboxed RISC-V browser, and guest
image. Record real guest output and a coherent native RAM/disk capture; QEMU is
only a reference and cannot satisfy this task. No Replay recording-driver claim.

## Deterministic acceptance

`python3 tools/chromium/capture-native.py --output target/replay-chromium-native`

The owned bounded run must build the affected native target, authenticate its
inputs, cold-boot the candidate, observe the real page's JS/WASM/canvas success
through private guest control pipes, inspect the real renderer sandbox state,
and capture matching guest RAM/disk artifacts after guest sync. Bind all inputs,
commands, guest evidence/digests and final artifacts to the submitted head. A
failure cannot be replaced by a cached QEMU result or a printed readiness claim.

## Adversarial verification

Medium risk: interrogate the recorded guest state and source/CPU/artifact bindings,
validate the pair and acceptance criteria, and try one bounded independent attack.
No emulator semantic change is part of this task; any required semantic fix must
be split into its own risk-tier task. Demo rollout and real GUI/input publication
are T29c; no user-visible working-browser claim precedes that proof.

## Verification log

(empty)
