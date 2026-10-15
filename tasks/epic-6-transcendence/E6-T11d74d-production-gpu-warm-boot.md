---
id: E6-T11d74d
epic: 6
title: Publish and prove an accelerated Omarchy warm-boot artifact
priority: 525.0270384
status: pending
depends_on: [E6-T11d74c]
estimate: S
risk: high
capstone: false
---

## Boundary

Produce a pinned actual Omarchy GPU-ready RAM/disk/GPU checkpoint pair from the
production guest, publish content-addressed artifacts, and make the default GPU
launcher/direct URL select it on compatible qualified hosts. Keep cold boot and
software recovery explicit. Document measured network versus cached restore
latency; no CPU/MIPS claim. Update unified docs/roadmap and deployed bundle.

## Deterministic acceptance

`make verify-E6-T11d74d` uses the actual default Omarchy URL without gpu=0 in a
fresh browser: observe snapshot restoration, qualified VirGL, original Mesa
renderer, new GPU jobs/draws/retained scanout after restore, trusted typing and
cursor displacement. Repeat launch and a final pristine clone. Record all four
software fast-boot/persistence regressions. Deploy and directly verify HTTPS
warm accelerated Omarchy plus exact source/image/artifact identities, launcher,
reader/roadmap and default127/0 with no unexpected errors.

## Adversarial verification

Reject a software screenshot, cached readiness event, cold boot relabelled warm,
wrong checkpoint/profile/disk pair or old worker output. Independently query
actual Mesa and advance a new real GPU workload after restore. Force stale
service-worker/artifact variants and a failed restore; require the declared
visible policy and keep original failures. Bound measured cached restoration
separately from artifact downloading.

## Verification log

### 2026-10-15 — worker — explicit accelerated warm-boot scope

The user's clarified goal is warm boot with GPU rendering. This is an ordered
implementation boundary of that request, not the cancelled software-default
workaround. Existing independent rendering/timekeeping proofs carry only across
unchanged code and dependency identities; new checkpoint behavior needs its own
recorded acceptance and fresh verifier.
