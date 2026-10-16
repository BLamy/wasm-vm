---
id: E6-T11d69
epic: 6
title: Provide original query admission and results for the GLES3 core
priority: 525.027037
status: cancelled
depends_on: [E6-T11d68]
estimate: M
risk: high
capstone: false
---

## Boundary

The qualified public GLES3 profile must provide its mandatory boolean occlusion
and transform-feedback-primitives-written query APIs through original VirGL
commands, retained result resources and real native queries/counters. Qualify
only implemented query types; keep optional counter/timestamp/conditional-render
features disabled. Preserve asynchronous availability, exact result width and
resource/generation ownership; do not substitute CPU estimates or fabricated
ready/results. Original unavailable/no-wait requests remain bounded.

## Deterministic acceptance

`make verify-E6-T11d69` records original native/Wasm/MMIO create/begin/end/get
query commands, actual hardware occluded/visible boolean outcomes and actual
transform-feedback primitive counts, followed by original guest-memory result
readback. The independent actual GLES3 probe must admit ANY_SAMPLES_PASSED,
ANY_SAMPLES_PASSED_CONSERVATIVE and TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN
without GL errors or rejected valid transport commands; independently check
nonempty/empty results and AVAILABLE without an unbounded wait. Probe unsupported
types and state transitions, retained custom-result extents, resets, destruction,
context loss and result ownership. Record affected high-risk gates, original
guest traces/digests and final clean clone. No larger API is inferred.

## Adversarial verification

Fresh verifier checks pinned native ABI/query type/result layout and all positive
query capability fields. Choose one bounded original state/availability sequence
and alternate completion schedule. Incorrect type, overlap, stale generation or
result span must refuse before effects. Distinguish false boolean/zero primitive
results from unavailable results. Alter a query result/availability transition
and demand that the independently predicted native/guest oracle fails.

## Verification log

### 2026-10-14 — independent negative GLES3 probe

A fresh verifier authored the bounded real-GBM/GLES3 probe
`tools/virgl-production/critic-fast-boots-egl-queries.c`, sourceSHA256
fc95965fa8441ca45e3626f87330ad3726889a1c5c3fb9309e760168eb2e8c11. Its actual
RISC-V executable SHA256de1b19ab00172978dfb963720cb7c4000352dc18ac1746282b6722b2110e7936
was uploaded only to the disposable original default Omarchy capture12-09,
authenticated by the guest sha256sum and run with a30guest-second alarm/no
QUERY_RESULT wait. Its original public serial transcript records renderer
virgl (wasm-vm WebGL2 VirGL), OpenGL ES3.0 Mesa26.2.2. Both boolean query
BEGIN calls return GL_INVALID_ENUM0x500. TF query BEGIN/END return GL_NO_ERROR,
but original resource-create/submit/result-transfer controls are rejected and
AVAILABLE stays0. Probe exits5 with QUERY_ADMISSION_FAIL.

Original evidence: production-omarchy-gpu-profile12-09/
control-response-gles-core-queries-01.json and the complete final original GPU
recording SHA256d862b1152342c73d75fcd4e9f4e41e53ce3644a6121e44d666a971350894aecb.
[Khronos ES3.0 glBeginQuery.xml](https://raw.githubusercontent.com/KhronosGroup/OpenGL-Refpages/main/es3.0/glBeginQuery.xml)
lists these three core targets and ES3 support;
Mesa26.2.2 version computation does not ensure these query paths. This is a
concrete missing mandatory API, not a request to advertise optional features.
The parent remains blocked; this ordered successor does not enter the active
lane until S68 is independently verified.

### 2026-10-14 — planning — decompose original queries

Replaced by ordered S tasks E6-T11d69a and E6-T11d69b. Fresh source inspection
shows boolean lifetime/result publication and logical transform-feedback counts
are separate boundaries: the latter must measure actual capture while accounting
for POINTS lowering and multiple output-buffer passes. No task activates before
its independently verified dependency.
