---
id: E9-T11
epic: 9
title: Record guest-visible time and entropy observations
priority: 524.911
status: in-progress
depends_on: [E9-T09]
estimate: S
risk: high
capstone: false
---

## Goal

Make host time and random inputs reproducible at their original guest positions.

## Boundary

Clock/RTC updates, lifecycle rebases, idle/timer decisions and supplied entropy, using the contract inventory. Deterministically derived values need a frozen policy; externally supplied values need recorded bytes.

## Acceptance criteria

- [ ] A workload reading time and RNG around sleeps, pause/resume and tab lifecycle changes replays identical observations.
- [ ] Replay consumes recorded values without reading the current host clock or CSPRNG for guest-visible results.
- [ ] Malformed entropy lengths, clock-policy mismatches and exhausted records stop with a typed divergence error.

## Deterministic acceptance

`make verify-E9-T11` records the risk-tier native/wasm, independent guest-state oracle and built-page assertions from a clean frozen head. Override `E9_SOURCE_EVIDENCE_DIR` to select a fresh output directory. A final pristine clone runs the same command. The worker submission and fresh verifier verdict below determine its proven status.

## Adversarial verification

Replay under a different wall clock and entropy provider, including background/resume transitions. Any influence from the replay host refutes the boundary.

## Verification log

### 2026-10-18 — worker — begin

E9-T11 is the first eligible task after independently verified E9-T10. Risk is high
because external clock samples and random bytes affect guest architectural state.
The slice will freeze the admitted ICount policy, intercept actual RTC observations
(including alarm polling) and entropy fills at ordered observation positions, and
prove the same workload consumes recorded values under different host providers.
Complete provider replay remains gated by T12–T14. No implementation or verification
claim is made by this activation entry.


### 2026-10-18 — worker — frozen local and pristine submission

Runtime and acceptance harness: `7d52129e9277468cb2d8e8cfc83571d9d7fb8334`.
`E9_SOURCE_EVIDENCE_DIR=target/evidence/e9-t11-worker-final make verify-E9-T11`
passed all selected gates: 693 native tests, 81 Node protocol/input tests, no-std/default
wasm builds and clippy, built browser suite 127 passed/0 failed, zero console errors,
independent native RAM/RTC/ICount/trace and durable-object oracles, and actual retained
GPU factory instruction retirement plus a fresh physical draw. Worker report SHA-256:
`19e13fd2989eaa6d30ba7c6a8485f221f9e914ce86fabc2966f048245ba80e19`.

`python3 target/e9-t11-cold-wrapper.py` ran the same acceptance command from an
independent detached clone with scrubbed environment and initially empty compiler target.
Cold receipt SHA-256 `703c325f8e60e033ef9b2c65cfdf8952baa8f8d5422a5e8c8f5e84e5163f4043`;
acceptance report `323a57add267b0516bdb51f24169650c4904b79d9fe769be387f6ba57be97e5b`.
Original recordings remain in `target/evidence/e9-t11-worker-final/` and
`target/evidence/e9-t11-cold-final/`; authenticated compact copies are in
`evidence/e9-t11/worker-final/` and `evidence/e9-t11/cold-final/` (with wrapper source).

Claim: the real RV64 RTC/RNG/WFI workload retains identical frames, guest UART bytes,
retirement traces and source receipts across replay quanta 1/7/64 with hostile providers
and zero replay host reads. Two native seeds, policy/length/order/exhaustion refusals,
recorded provider failures, restored source cursors, safe receipt yielding, and transactional
DMA quota failure execute in the recordings. The browser actually freezes/resumes the
page while the guest is paused, injects a real Web Crypto outage, and reopens direct and
whole-worker production journals after guest poweroff. Each natural-terminal journal has
413 receipts ending at transition527/retired526; the original fixed workload ends at
transition523/retired522. Full Linux replay remains gated by T12–T14.

`bash tools/deploy-cloudflare.sh` initially hit a transient rootfs download stall and
Wrangler's upload-size fallback limit. The unchanged script succeeded on retry with
read-only curl retries and RAM temporary storage; every remote artifact was byte-verified.
Deployment: `https://d269e881.wasm-vm.pages.dev`, production `https://wasm-vm.pages.dev/`.
Logs: `/tmp/e9-t11-deploy.log` (failed attempt), `/tmp/e9-t11-deploy-retry.log` (success).
The new runtime is published; public-site proof and fresh verifier verdict follow this
entry. No runtime code changes are included in this artifact/log commit.
