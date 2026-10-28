---
id: E9-T22t
epic: 9
title: Bound large session block DMA independently of host completions
priority: 524.92202987
status: in-progress
depends_on: [E9-T22s]
estimate: S
risk: high
capstone: false
---

## Goal

Let the frozen original cold desktop complete its observed 1,179,648-byte
virtio-blk write. E9-T22s proved that the in-range write currently completes
`S_IOERR` before the COW backend because a host completion-payload limit is
also used as the guest's block DMA limit. Keep these two boundaries separate.

## Boundary

One bounded session-block transfer change. The maximum guest block request
must remain finite and fit the 16 MiB authenticated base-chunk cache; host
completion envelopes, immutable base chunks, the 524,288-sector COW limit,
device ownership, frozen image/workload/clock/checkpoint cadence, and replay
policy stay unchanged. This task makes no first-frame or full-workload claim.

## Acceptance criteria

- [ ] The real virtio descriptor path completes an in-range 1,179,648-byte
  session COW write with `S_OK`, exact bytes and used-ring advancement. Reads
  spanning multiple authenticated base chunks remain atomic across parks and
  overlays; replay preserves the resulting disk state.
- [ ] A sector-aligned request above the new finite DMA bound still completes
  `S_IOERR` without a backend call, while out-of-range and COW-capacity paths
  retain their distinct behavior. Host `MAX_RESULT` and authenticated
  completion validation do not widen.
- [ ] The built browser exercises the corrected guest-visible path without
  console errors, and the demo's session-capability evidence is updated.
  Record exact-head guest and browser evidence, then obtain a fresh Daybreak
  adversarial verdict on the diff and evidence.

## Deterministic acceptance

`make verify-E9-T22t` on a clean exact head.

## Adversarial verification

Attack just below, at and above the transfer boundary; split DMA over
multiple descriptors; exercise a read that needs more than one authenticated
base chunk, a partially overlaid read, out-of-range sectors, COW capacity,
reset/park and replay. Try to use a larger guest DMA to smuggle an oversized
host completion or to exhaust the cache with pinned chunks. Reject evidence
that only calls the backend directly and never executes the virtio chain.

## Verification log
