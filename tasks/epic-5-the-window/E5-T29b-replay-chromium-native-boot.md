---
id: E5-T29b
epic: 5
title: Run recording-capable Replay Chromium on native wasm-vm and capture its image pair
priority: 0.382
status: pending
depends_on: [E5-T29a, E5-T30d]
estimate: S
risk: medium
capstone: false
---

## Boundary

Qualify the authenticated candidate on wasm-vm's actual CPU and browser device
layout. Use the existing Linux kernel, JIT, sandboxed RISC-V browser, and guest
image. Record real guest output and a coherent native RAM/disk capture; QEMU is
only a reference and cannot satisfy this task. The genuine Replay recording driver is REQUIRED. Ordinary browsing with recording
disabled cannot satisfy this task. A separate RISC-V driver port must be qualified
and added as an explicit verified dependency before activation.

## Deterministic acceptance

`python3 tools/chromium/capture-native.py --output target/replay-chromium-native`

The owned bounded run must build the affected native target, authenticate its
inputs, cold-boot the candidate, observe the real page's JS/WASM/canvas success
through private guest control pipes, inspect the real renderer sandbox state,
load the actual recording driver with recording enabled, produce a genuine
recording from known page actions, validate it through Replay's own reader/replay
path, and capture matching guest RAM/disk artifacts after guest sync. The upstream
driver-mode launch policy is distinct from the ordinary-browsing sandbox pre-check;
do not force `RECORD_REPLAY_DONT_RECORD` or replace the driver with a shim. Bind all inputs,
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

### 2026-11-03 — scope correction

The user explicitly confirmed the entire point is the Replay recording driver
inside wasm-vm. The prior browsing-only qualification was insufficient. The real
driver source is available locally; this task cannot activate until its RISC-V
port and driver-specific acceptance are decomposed and verified. No plain-browser
run or QEMU success is a completion substitute.
