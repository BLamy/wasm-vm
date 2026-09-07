---
id: E5-T26b
epic: 5
title: Virtio-GPU resource, scanout, cursor, and shadow snapshot
priority: 526.2
status: verified
depends_on: [E5-T26a]
estimate: S
risk: high
capstone: false
---

## Goal

Snapshot the desktop GPU state needed to redraw the same front buffer after restore, including
resource metadata, host shadows, scanout/cursor bindings, and pending damage.

## Boundary

Own virtio-gpu serialization/deserialization and deterministic shadow compression. Do not own
keyboard, audio, agent reconnect, or the final browser reload flow.

## Acceptance criteria

- A scripted resource map with non-default dimensions/formats, scanout, cursor hotspot/position,
  and pending damage serializes and restores with byte-identical state and front-buffer CRC.
- Shadow compression reports raw size, encoded size, ratio, and bounded decompression checks for
  both fbcon-like and desktop-like fixtures; malformed compressed data is rejected.
- Restore refuses a missing resource or incompatible format before touching the live scanout and
  then renders one full repair frame when the state is valid.

## Verification command

make verify-E5-T26b

## Adversarial verification

Try an out-of-range resource id, overlapping scanout binding, truncated shadow, and a cursor
hotspot outside its image. Each must fail closed without corrupting another resource.

## Verification log

### 2026-09-06 — worker — IMPLEMENTED
- Implementation commit: `2b985379727f10586938f11831be35dc149408a8`.
- Exact-head evidence: `evidence/e5-t26b/native-final.json` (SHA-256 `9dc545757ae5e0740913ab7d5228ed97b841df49aed604ad1b02515374878e78`).
- Command: `make verify-E5-T26b` (exit 0). The run passed format, both GPU-trace clippy gates, 5 GPU snapshot tests, 15 resource tests, 5 damage tests, 6 tile tests, 3 block-quiesce tests, 6 CPU-resume tests, and the no-default-features wasm32 build.
- The recorded tests exercise a non-default-format 8×4 resource with scanout, cursor hotspot/position, pending damage, dirty tiles, and front-buffer CRC equality; deterministic repeat/literal shadow compression reports raw/encoded sizes and ratio. Truncated payloads, forged shadow runs, missing scanout resources, incompatible formats, and an out-of-range cursor hotspot all fail before the target resource map changes. Valid restore emits exactly one full scanout repair frame.

### 2026-09-06 — worker — REMEDIATION SUBMITTED
- Verifier refutation fixed in commit `2f1ce24a60156cefcd2343369553fed57e337652`: `0xffff_ffff` is now reserved as the no-scanout resource ID and forged records using it are rejected before detached reconstruction. The fixture now carries nonempty backing metadata, and atomic malformed backing, damage, and dirty-tile metadata regressions are covered.
- Re-recorded exact-head evidence: `evidence/e5-t26b/native-final.json` (SHA-256 `c4188b3f73741f972ebff536f6701060b49072e1418eb14b9264313e10feec14`); `make verify-E5-T26b` passed with 6 GPU snapshot tests, 15 resource tests, 5 damage tests, 6 tile tests, 3 block-quiesce tests, 6 CPU-resume tests, clippy, format, and wasm32 build.

### 2026-09-06 — verifier — VERDICT: refuted

- P1 resource/scanout round-trip — FAILED. Predicted that a live nonzero resource id would
  either be representable byte-for-byte with its scanout binding or receive a typed pre-commit
  rejection. `ResourceMap::create` accepts every nonzero `u32`, including `0xffff_ffff`
  (`crates/core/src/dev/virtio/gpu/resources.rs`:854-867), but the snapshot codec also defines
  that value as `NONE_RESOURCE`, writes it for both `None` and `Some(u32::MAX)`, and decodes it
  only as `None` (`crates/core/src/dev/virtio/gpu/snapshot.rs`:24-28,127-145,202-228).
  Through the public `VirtioGpu` facade, a source with resource `4294967295` bound to scanout 0
  restored successfully as `scanout_resource=None` and emitted zero repair frames instead of one
  (`evidence/e5-t26b/verifier/sentinel-collision.log`; commit/repair point
  `snapshot.rs`:263-290). Reserve/reject that id or encode absence without aliasing a valid id,
  then retain this exact round-trip/repair regression.
- P2 deterministic bounded compression — HELD. Predicted repeat and literal fixtures would be
  deterministic, report exact sizes/ratios, round-trip, and reject an oversized run before output
  growth. The committed tests passed (`snapshot.rs`:844-867); the independent facade harness
  observed fbcon `4096 -> 17` bytes (`ratio_milli=4`) and desktop `4096 -> 4109`
  (`ratio_milli=1003`) with identical repeated encodings. Truncation and forged
  `u32::MAX` shadow runs remained typed, atomic refusals (`snapshot.rs`:806-841).
- P3 listed fail-closed attacks — HELD except for P1's sentinel collision. Missing scanout,
  incompatible format, truncated/forged shadow, and out-of-range hotspot attacks preserved the
  target resource records (`snapshot.rs`:775-841). Fresh public-facade zero-id, duplicate-id,
  incompatible-format, and forged multi-scanout-count attacks returned respectively
  `invalid_resource`, `duplicate_resource_id`, `incompatible_format`, and `invalid_count`, with
  `target.to_snapshot()` unchanged (`sentinel-collision.log`).
- P4 exact-head gate — HELD. Fresh `make verify-E5-T26b` at evidence head
  `ef94421b6b2ba4997f980a25f89aa00b9f21c00e` / implementation
  `2b985379727f10586938f11831be35dc149408a8` passed fmt, both clippy gates, 5 snapshot,
  15 resource, 5 damage, 6 tile, 3 block-quiesce, and 6 CPU-resume tests plus the
  no-default-features wasm32 build (`Makefile`:1038-1053). Evidence SHA-256 independently
  matched `9dc545757ae5e0740913ab7d5228ed97b841df49aed604ad1b02515374878e78`
  (`evidence/e5-t26b/native-final.json`:1-27).
- COVERAGE — NEEDS EVIDENCE after the semantic fix. Valid snapshot reconstruction exercised the
  new damage/tile/resource paths, but the fixture leaves `backing` empty despite claiming backing
  metadata, and no retained attack reaches zero/overflowing backing entries, malformed damage
  bounds/collapse shape, or dirty-bitmap word/popcount/tail-bit rejection
  (`resources.rs`:625-695; `damage.rs`:71-99; `tiles.rs`:155-187). Add a nonempty backing
  round-trip and one atomic rejection per validation family. Public `GpuState`/`VirtioGpu`
  forwarding, canonical map order, successful repair, and no-std compilation are covered;
  allocation-failure arms and declarative error-code mappings are waived.
- SUITE: retain all existing snapshot/resource/damage/tile and resume regressions plus the
  sentinel-collision seed. No implementation or test code was modified by the verifier.
  Commands: `git diff --check 2b985379^ 2b985379`; `make verify-E5-T26b`; two offline
  path-dependent public-facade mutation runs; worker evidence SHA-256 audit.

### 2026-09-06 — verifier recheck — VERDICT: verified

- P1 sentinel-safe resource/scanout round-trip — HELD after remediation. Predicted
  `0xffff_ffff` would be rejected both at live resource creation and when forged into a snapshot
  record, before allocation or live-map swap. The shared `NONE_RESOURCE_ID` guard now rejects it
  in `ResourceMap::create`, detached reconstruction, and parser preflight
  (`crates/core/src/dev/virtio/gpu/resources.rs`:23-28,631-640,856-872;
  `crates/core/src/dev/virtio/gpu/snapshot.rs`:24-28,369-380). The committed regression leaves
  the target unchanged (`resources.rs`:957-969; `snapshot.rs`:846-871), and the prior public-
  facade collision attack now rejects both source creation and a forged record
  (`evidence/e5-t26b/verifier/remediation-pass.log`).
- P2 deterministic bounded compression — HELD, carried forward because codec semantics are
  unchanged. Fresh tests again round-tripped both fixtures, rejected oversized runs, and reported
  exact verifier values: fbcon `4096 -> 17` bytes (`ratio_milli=4`) and desktop
  `4096 -> 4109` (`ratio_milli=1003`) (`snapshot.rs`:942-965;
  `remediation-pass.log`).
- P3 atomic malformed-input handling — HELD. Prior missing-resource, incompatible-format,
  truncated/forged-shadow, hotspot, zero/duplicate-id, and forged-count results remain valid.
  New evidence round-trips nonempty backing `(0x1000, 128)` byte-for-byte
  (`snapshot.rs`:680-753), while zero-length backing, out-of-bounds damage, invalid collapsed
  shape, dirty popcount mismatch, and dirty tail bits each return before the target records change
  (`snapshot.rs`:846-940). A fresh overflowing-address mutation (`u64::MAX - 3` plus length 4)
  also preserved the public target snapshot (`remediation-pass.log`).
- P4 exact remediation head — HELD. `evidence/e5-t26b/native-final.json` names implementation
  `2f1ce24a60156cefcd2343369553fed57e337652`; SHA-256 independently matches
  `c4188b3f73741f972ebff536f6701060b49072e1418eb14b9264313e10feec14`.
  Fresh `make verify-E5-T26b` passed fmt, both clippy gates, 6 snapshot, 15 resource, 5 damage,
  6 tile, 3 block-quiesce, and 6 CPU-resume tests plus no-default-features wasm32
  (`evidence/e5-t26b/native-final.json`:1-29; `Makefile`:1038-1053).
- COVERAGE — HELD. Every remediation hunk executes in retained tests: sentinel declaration and
  create/parser/detached-map guards, nonempty backing serialization, and all requested malformed
  metadata families. The independent facade run additionally covers backing-address overflow and
  the original sentinel attack. Allocation-failure arms, declarative error-code mappings,
  host rr, independent machines, WebKit, browser flow, and later input/sound/agent payloads remain
  explicitly waived/out of scope.
- SUITE: retain the six snapshot tests, existing resource/damage/tile and resume regressions,
  sentinel-collision seed, and remediation facade audit. No implementation code was modified.
  Commands: `git diff --check 9f4f3d07 2f1ce24a`; `make verify-E5-T26b`; offline public-facade
  sentinel/backing mutation run; worker evidence SHA-256 audit.
