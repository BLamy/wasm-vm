---
id: E5-T34b
epic: 5
title: Minimal read-only rootfs for Replay Chrome 108 and Node 26 on one desktop
priority: 0.3872
status: in-progress
depends_on: [E0-T34, E5-T33, E5-T34a]
estimate: S
risk: medium
capstone: false
---

## Boundary

Build the smallest rootfs that runs both: kernel config trimmed to the wasm-vm device set, busybox init, a single-process Wayland kiosk compositor, minimal fonts, Replay Chrome 108 (the verified riscv64 build, E0-T34; Chrome 157 is blocked on Replay's uplift, E5-T32b), Node 26 and a terminal. Pack it as a compressed read-only filesystem; run tools/privacy/check-no-replay-backend.py over the source tree before packing and over the packed image after.

## Deterministic acceptance

Native wasm-vm boot reaches the desktop with Replay Chrome 108 showing smoke.html success and a Node 26 terminal, with recorded boot time, image size and guest RAM high-water mark.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence and run one
bounded novel attack.

## Verification log

(empty)
