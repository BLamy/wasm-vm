---
id: E6-T11d53
epic: 6
title: Carry qualified uniform and shared-role buffers through native desktop submission
priority: 525.027039000398
status: in-progress
depends_on: [E6-T11d52, E6-T11d18]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend only the selected desktop native buffer metadata envelope to match the
independently qualified host store's original creation hints:0,16,32,48,64,80,
96 and112. Target0/format64 remains byte-addressed, height/depth/layers1,
level/sample/flags0, with the existing per-resource and aggregate budgets.
Ordinary constructors retain their historical profiles. Native accepted owner
snapshots, DMA and later queue completion must compose with existing selected
host uniform/index/vertex ownership. No new shader, image, scanout or positive
production capability is granted.

## Deterministic acceptance

`make verify-E6-T11d53` sends all eight original hint combinations through real
selected Wasm virtqueues and actual hardware WebGL2 storage. Transfer original
guest backing words, bind a nonzero uniform bank in both stages, execute a
standard GPU draw and independently check every pixel of a complete output plane.
Record three schedules, actual native calls, full guest input/output, request,
response, ring and response guards. Check native/host identity, generation,
membership and byte accounting before and after admission, transfer, completion,
reset and disposal. Vary source words after backing attachment to prove live DMA.

Reject unsupported masks, dimensions, flags and budgets before publication;
check complete native/host state and GPU allocations remain unchanged.
Preserve selected64/65 and ordinary16/17 ownership boundaries. Authenticate
unchanged D18/D49/D50/D51/D52 facts by matching source/evidence identities;
no new host semantic claim rests on a fixture or null sink.

Record native guest-loop traces and digests and changed Rust/Wasm/JS execution.
Run the scoped fmt/clippy/native/wasm/browser submission and one final scrubbed
pristine clone. The built/default/live demo retains127/0, absent proof exports
and the existing graphics partial pip; rebuild/commit/deploy per AGENTS.

## Adversarial verification

Attack every original hint and unsupported neighboring masks, budget rollback,
accepted identities, SG/backing epoch/generation, dirty source ownership and
reset/cancellation. Run independent schedules and one bounded integration attack.
Sabotage native selected buffer admission so a uniform/shared-role request is
refused; require the independent exact response or pixel oracle to fail.
Classify changed-hunk coverage and authenticate complete bodies and final clone.
Carry unchanged held results incrementally. A fresh verifier alone sets verified.

## Verification log

### 2026-10-12 — worker — native buffer admission negative readiness

D52 is independently verified at `59bf446955cc2b78b84d94fcd03cb3f3f4f1c230`
and published as open/draft PR530 on the existing stack500. The continuity audit
preserves both stack identities and every130 prior PR identity, order, head and
base; all131 PRs remain open/draft/unmerged.

At that clean verified head, the real Wasm/native queue refuses uniform bind64
and combined bind112 target0/format64 requests with0x1205 before any host
callback or GPU allocation. Full native/host owner snapshots remain unchanged.
The same original metadata succeeds through the selected qualified hardware
host store. Each buffer owns64 GPU bytes and disposal releases all objects.
The bounded readiness matrix also reproduces native refusals for RGBA8 mip
chains, RG8, RGB8, floating RGBA and Z16 while the qualified host admits them.
This S task closes only the byte-addressed buffer-hint boundary.

Exact repro:
`node /tmp/wasmvm-selected-native-storage-readiness.mjs --output /tmp/wasmvm-selected-native-storage-readiness-verified`.
The complete runner is retained as archive member `readiness-runner.mjs`.
The run records359 actual GL calls on M4 Max Metal, zero browser errors,
complete request/reply/ring/guard/owner/source bodies and no Linux guest,
DMA, shader draw or production capability claim. Its68 complete bodies are
sealed in `evidence/virgl-production-readiness/native-buffer-role-gap/`:

- manifest `00f3d741c0bee960f4c2839e922325963c80f21d802b7a480288657a6158e8e9`
- index `ac7d984aeb87341e1b169a14410b733593c3a64486e1f2d9bf5f17a7b0ca3051`
- archive `2d7f61b9b143692dc46a1369d104446cfa6cf2ded86933c2fda2e52e43369b51`
- report `6b70b791ae1cf68be436449652979e12a19e267bf7f3c6ef5b9ad104162f2619`

The explicit human instruction continues production guest graphics ahead of
unrelated general-queue work. Typed capabilities, complete API/storage/image
transport, actual Mesa/Hyprland, worker/scanout and throughput remain parent work.

