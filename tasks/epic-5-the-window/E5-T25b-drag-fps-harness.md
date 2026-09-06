---
id: E5-T25b
epic: 5
title: Measure repeatable real-window drag FPS and bottleneck counters
priority: 525.2
status: implemented
depends_on: [E5-T25a]
estimate: S
risk: medium
capstone: false
---

## Goal

Build the headed Playwright scenario that drags a real Foot window across the T18
desktop and measures drawn presents over wall time. The result must expose the guest
execution, upload, and present buckets needed by the later baseline instead of
reporting a browser-only animation rate.

## Boundary

Own the deterministic 300-step pointer script, warm-up policy, five-run aggregation,
and machine-readable drag result. Do not implement input hooks or latency-to-photon
measurement; consume T25a's frozen boundary only.

## Deliverables

- `web/bench/desktop-perf.ts` drag scenario and JSON output with FPS p50/p95,
  bytes/frame, instructions/frame, and guest/transfer/present durations.
- A headed pinned-browser runner that records the exact viewport, DPR, browser,
  image, and commit.
- Five retained runs with coefficient of variation and a deterministic null-sink
  attack result.

## Acceptance criteria

- [ ] Five unattended drag runs each complete 300 smooth moves and report CV < 15%
      under the named dev-machine configuration.
- [ ] The real drawn-present counter, not requestAnimationFrame callbacks alone,
      determines FPS; the result includes nonzero attribution counters.
- [ ] The null-sink attack materially craters or rejects the drawn-FPS result and
      cannot pass by counting acknowledged-but-undrawn presents.
- [ ] The result is reproducible from `make verify-E5-T25b` with no inherited
      `RUSTFLAGS`, `CARGO_*`, or logging environment.

## Verification command

make verify-E5-T25b

## Adversarial verification

Run with the null sink, a busy guest, 4x CPU throttle, and DPR 2. Compare the full
present and attribution records, not just the summary FPS, and document which values
are baseline configuration versus stress observations. A window that does not move,
or a run that draws no damage, must fail rather than produce a plausible number.

## Verification log

### 2026-09-06 — worker — IMPLEMENTED

Implementation commit: `765fefcb` (`perf(e5-t25b): measure real desktop drag FPS`).

`make web-build` and `make verify-E5-T25b` passed at the frozen worker head. The
verification target ran syntax checks, five deterministic Node tests, the source/dist
release audit, and a headed Chromium run against the real Foot window. The runner
scrubs `RUSTFLAGS`, `RUST_LOG`, and all `CARGO_*` variables before starting the
server, records the pinned viewport/DPR/browser/image/manifest, and retains the full
present records rather than counting animation callbacks.

The browser evidence is `evidence/e5-t25b/browser/drag-fps.json` (SHA-256
`67f4dbf8723451383b56bf5d8565309c8a91c765d36c6587a6a1960a925860dd`) and
`evidence/e5-t25b/browser/drag-fps.png` (SHA-256
`58b0e53df2ec4c3ef30e8c4d71f349962e0c170b3597849899220ce3655938f1`). Headed
Chromium was `152.0.7977.76`, viewport `1440x1050`, DPR `1`, image SHA-256
`811267cbf96c1e055e31063829580432d5e5e343cff1a975f5fc10664cc2e00e`, and desktop
manifest SHA-256 `935a9fe2bf6022b01ac6147665b9ca59736930b6e265e33069318e4d9cc2ccaa`.
All five runs requested exactly 300 pointer moves and reached at least 300 processed
pointer frames; drawn presents were `92, 94, 100, 100, 114`. The aggregate was FPS
p50 `4.397911607682904`, p95 `4.749077887383471`, mean `4.307047618230559`, and
CV `8.429883380318232%` against the `<15%` limit. Every run had nonzero guest
instruction attribution and guest/present duration buckets; browser and HTTP error
arrays were empty. The null-sink attack returned
`{drawnPresents:0,accepted:false,reason:"no-drawn-presents"}`.

The release audit reported source/dist terminal, page, and perf-module parity, an
exact dual query gate, and an installed-and-cleared scheduler sampler. The worker
submission is ready for a fresh verifier to run the required null-sink, busy-guest,
4x-throttle, DPR-2, no-window, and no-damage attacks. Independent machines, WebKit,
and host-rr legs remain waived by repository policy.

Commands: `make web-build`; `make verify-E5-T25b`; `shasum -a 256
evidence/e5-t25b/browser/drag-fps.json evidence/e5-t25b/browser/drag-fps.png`.
