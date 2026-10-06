---
id: E6-T12g6m5b1
epic: 6
title: Authenticate original 92cb compositor draw-time quad geometry
priority: 525.0270105821
status: in-progress
depends_on: [E6-T12g6m5a]
estimate: S
risk: high
capstone: false
---

## Boundary

Reconstruct every original 7bf4d0d0/92cb866a draw's paired constant banks, vertex elements, buffers, resource lifetime, draw parameters, and draw-time backing from authenticated VirGL packets and snapshots. Prove the exact vertex input used by the recorded draws is the finite `[0,1]` quad or reject. This is a capture fact only: a future compiler or renderer must separately enforce the geometry at draw time. Do not grant a shader numeric certificate or production admission here.

## Deterministic acceptance

`make verify-E6-T12g6m5b1` independently parses and hashes the original capture, inventories all 1,957 relevant draws and every buffer snapshot and mutation, emits a bounded geometry/paired-bank artifact with packet citations, and rejects changed vertex coordinates, format, binding, lifetime, count, source and bank. A native/Wasm verifier consumes that artifact byte-identically and computes the bounded `CONST[4] * uv - CONST[0]` first-power base for each captured bank, including endpoint and interior values. Record exact-head evidence and a pristine clone; submit to a fresh critic.

## Adversarial verification

Attack stale backing, resource-ID reuse, write-after-snapshot, vertex format and offset, indexed/instanced topology, negative/nonfinite vertex words, bank/source substitutions, and arithmetic overflow. A sampled pixel alone cannot bound every accepted fragment. Inspect packet citations and the entire draw set; the translator must still reject the unchanged full original shader without geometry authority.

## Verification log

### 2026-10-05 — worker — implemented; adversarial verification requested

Source head `77aee01dc216b03d3dd5c5620c3c138b8187531c`. Ran `make verify-E6-T12g6m5b1` and `python3 tools/virgl-92cb-geometry/cold.py target/evidence/virgl-92cb-geometry/cold-exact` at that exact head, then sealed `evidence/virgl-92cb-geometry/worker/recording.tar.gz` (SHA-256 `be2329a85314bea6a9d843216182ebbec0a86d03bfc42f9dc7b94e734502cf3e`) and `records.json` (SHA-256 `59ba8f7678cde050ad952c022ee13f09ca958df7af5a30fac24545514a56698d`). The 34 recorded files include authenticated packet/draw citations, the 1,069 vertex-resource snapshots, complete three-bank binary, native/Wasm byte-identical outputs, fault rejections and native coverage. The pristine clone passed with empty before/after status. Independent endpoint arithmetic over all four vertices and captured banks gives maximum first-power bases `(306,306)`, `(1030,774)` and `(988,732)` for all interpolated UVs in `[0,1]`. Both full original pair entry points remain rejected; this capture-only result grants no future draw or shader numeric authority. `make ci` was attempted at the frozen head and fails in untouched macOS-incompatible `crates/wvseccomp` libc symbols and existing `items_after_test_module` Clippy error in `crates/core/src/dev/virtio/gpu/mod.rs`; log at `target/evidence/virgl-92cb-geometry/make-ci.log`.

### 2026-10-05 — fresh verifier — VERDICT: refuted

- **Captured geometry — HELD.** Predicted that each selected draw would cite the current submit snapshot of a single live resource 41 and exact two-attribute, four-vertex strip. An independent ordered replay of all 1,212 command submissions found 1,957 matching draws and reproduced every `hot/geometry.json` draw citation and the 80/30/1,847 pair counts. The only resource-41 lifetime is create 5243, attach 5247, detach 52729, unref 52731; its sole mutating packet is `TRANSFER3D` at event 5328/blob `b3fef5cc…`/offset 56. All 1,068 submit snapshots contain the same first 64 quad bytes; the initial attach snapshot is distinct. The two shader creation packets at event 5328/offsets 5608 and 6224 independently hash to the claimed complete source digests. Hold this result across a repair that does not change capture parsing, geometry, or their evidence digest.
- **Envelope, controls, and portability — HELD.** Predicted finite clip vertices with `W=1` and base envelopes no greater than the endpoint maxima. The unchanged vertex pc4/pc7 gives constant `W=1` and direct UV, so clipping/interpolation preserves `[0,1]`; independently decoded scales `(310,310)`, `(1034,778)`, `(992,736)` and center `(4,4)` give `(306,306)`, `(1030,774)`, `(988,732)`. Negative/nonfinite vertex and transform words, altered format/offset/binding, indexed/instanced draw, stale snapshot/resource, negative exponent/scale, and scale overflow rejected in bounded attacks. Hot/cold archive members match all 34 indexed digests and receipt source/binary digests; native and Wasm outputs match, both original pair entry points reject, and the cold report records pristine before/after status at source head `77aee01d`. Hold unchanged portions incrementally.
- **Complete paired bank authentication — FAILED.** Predicted changing any emitted bank word away from its cited `SET_CONSTANT_BUFFER` packet would fail. In bank 0, fragment `CONST[5].x` is used by original pc0 and is `0x00000000` in event 7387/blob `742b0e13…`/packet offset 5292 (word 23, blob byte 5384); the recorded `hot/geometry.bin` stores the same word at byte 216. Changing that artifact word to `0x3f800000` and updating its self-referential `geometry.json` binary/pair hashes and 1,847 draw pair citations still made `original-92cb-geometry-test` exit 0 with output byte-identical to the recorded native/Wasm result, and `receipt.py` exit 0 reporting 1,957 authenticated draws. `capture.py:68-76` checks only selected words; `receipt.py:53-67,73-88` never compares all 164 bank words to the cited packets. Demand independent packet-byte comparison for every paired-bank record (including live set identity) and a recorded changed-used-word fault that fails. A sabotage run also changed this word after authentic packet parsing and produced a passing receipt when matching outputs were supplied. No product semantics were contradicted; the deterministic acceptance's bank-substitution rejection was.
- **COVERAGE/SUITE.** The recorded native audit reports 102/102 covered lines; capture, native, Wasm, receipt, cold and seal paths executed, with declarative/task text waived. The missing packet comparison is absent behavior rather than an unexecuted changed hunk. Do not promote a suite artifact until the refutation is repaired; retain the exact `CONST[5].x` mutation as the new deterministic fault.

Verifier commands: independent Python replay of `events.jsonl` and authenticated command/backing blobs; direct native binary with altered `geometry.bin`; `python3 tools/virgl-92cb-geometry/receipt.py <scratch-directory>`; targeted Python mutations of `checked_draw`, `checked_quad`, `complete_banks`; archive/receipt SHA-256 audit. The altered-bank scratch directory was `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-92cb-critic-used-bank-x2f368t_` (ephemeral); reproduce by changing `hot/geometry.bin` byte 216 as above and recomputing the proof's pair/bin digests and corresponding draw pair citations.
