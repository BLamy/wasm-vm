---
id: E6-T12b
epic: 6
title: Replay bounded resource backing and VirGL uploads and readbacks
priority: 525.02693
status: verified
depends_on: [E6-T12a]
estimate: S
risk: high
capstone: false
---

## Boundary

Add the renderer resource/backing model and transfer executor for the captured
textured-scene profile: buffer resources, single-level RGBA8 2D textures, CPU
staging backing, TRANSFER3D and both COPY_TRANSFER3D directions. Validate context
attachment, resource identity/generation, logical extents, IOV lengths, checked
box/stride/layer-stride/offset arithmetic and allocation budgets. Public handles,
attached guest backing and storage retained by objects have separate lifetimes.
The first uploads precede CREATE_SUB_CTX1 and use the context's default state.

Use original resource metadata and snapshots 156/157/160 for vertex/index/texture
input. Preserve the distinction between 64/12-byte logical buffers and 4096-byte
backing pages, and the 1MiB staging allocation. READ_FROM_HOST reverses the named
copy source/destination fields. Later snapshots containing renderer readback are
comparison evidence only, never replay inputs. No device/capset activation.

## Deterministic acceptance

`make verify-E6-T12b` proves the original 64-byte vertex, 12-byte index and
16-byte texture transfers using actual WebGL2 buffer/texture readback, plus
independent transfer-box/stride/IOV cases for both directions. Record exact
source event/hash/ranges, resulting bytes, Node/browser checks, bounded resource
usage and zero browser errors. These isolated transfers do not claim whole-stream
replay. Run the affected high-risk resource-boundary gates and final clean clone:
Node pure-layout/lifecycle checks, original decoder regression, actual hardware
WebGL2 transfer and hostile-state proofs, bounded repeated mutation/recovery,
input sabotage and source/evidence hashes. Production Rust, shader compiler and
Wasm APIs are unchanged by this boundary; their proofs carry forward.

## Adversarial verification

Attack overflow, short IOVs, row/layer overlap, invalid levels/formats, missing
attachments, stale/reused IDs, duplicate attach and detach during a pending copy.
Reject before reading/writing outside the validated resource/backing range.
Prove reference retention after public unref and eventual storage release.
Poison captured output snapshots and require unchanged upload results; change
one genuine input texel/index and require the independent byte oracle to fail.

## Verification log

### 2026-10-03 — worker — activated (UTC)

Follows independently verified E6-T12a (`c8a34f4a`, PR #407). This isolated S
boundary creates resource/backing ownership and actual WebGL2 transfer storage;
state objects and draw replay remain separate. Pending-copy attacks use prepared,
single-use tickets, whose upload bytes are snapshotted and whose context/backing
identity is rechecked before execution. These tickets are not accepted asynchronous
virtio submissions; ordered fences remain E6-T11b. No other task is active.

### 2026-10-03 — worker — implemented

Frozen runtime/harness head: `fadf4ba813fa31694fb0a560f89c61c740ea3643`.
Recorded commands:

- `VIRGL_RESOURCE_EVIDENCE_DIR=evidence/virgl-resources/worker make verify-E6-T12b`
- `python3 tools/virgl-command/resources-cold.py --output evidence/virgl-resources/cold-clone`

The original corpus resource metadata and source snapshots 156/157/160 feed only
64 vertex bytes, 12 index bytes and 16 texture bytes into their recorded backing
lengths. Independent direct GL reads confirm those original inputs reached actual
WebGL2 objects. Production backend buffer reads are exercised separately. Three
original READ_FROM_HOST copy packets move an independently generated GPU pattern
to staging offsets 64/4160/8256; they do not claim captured draw replay. Exact-fit
and short scatter/gather cases, split pixels, nonzero offsets, padded rows and
full-resource default stride are checked in both directions. Every transfer runs
under renewed hostile VAO/FBO/PBO/pixel-store state. Index buffers retain their
required element-buffer binding class. Retained GPU textures survive detach,
public unref and numeric-ID reuse, then are deleted on last lease release.

Node/browser native results match: 9,258 assertions, 87 named rejection cases and
1,024 seeded layout mutations (311 accepted / 713 rejected). The hardware suite
adds 25,361 assertions. Lifecycle cases cover single-use upload snapshots,
context/membership/backing replacement, previously absent primary backing,
foreign/stale handles, retained resource budgets, backend failures and disposal.
Reflected input detach and resize reject before backing/budget publication.
Trusted GL allocation-failure controls are explicitly labelled fault probes,
separate from real transfer-success evidence. All final resource/CPU/GPU/scratch/
ticket/lease counters return to zero. The original resources account for 4,188
logical GPU bytes and 1,064,960 backing bytes; staging allocates no GL object.

All 12,288 selected reference-output bytes are poisoned without changing uploads.
Separate browser input sabotages fail at the independent original-byte oracles:
texture byte 0 expected 255/observed 254; index byte 0 expected 0/observed 1.
The unchanged decoder regression also passes. Chrome 154.0.8037.93 reports ANGLE
Metal / Apple M4 Max with hardware WebGL enabled and zero browser errors. Worker
native elapsed 70 ms and browser elapsed 144 ms describe this bounded acceptance
run only, not guest rendering throughput. Source hashes, served-byte hashes,
input event/blob provenance, results, V8/CDP coverage and screenshots are retained.
The browser capture was visually inspected.

Evidence:

- `evidence/virgl-resources/worker/receipt.json`, SHA-256
  `f60289206aad7af60256d204360e6ab727d0f07cbb23c9850a607db6413f4f86`.
- `evidence/virgl-resources/worker/hardware/report.json` and `browser.png`;
  screenshot SHA-256 `9748d9abfdca283518634a6446a76472a82093aa6e788b0ce1e48e699d770d01`.
- Runtime source SHA-256
  `728a31ed543fb7565580305f545e51e1d91e15c6881f8318db1190bbb1d04090`;
  counters in `worker/node-coverage.json` and `worker/hardware/browser-coverage.json`.
- `evidence/virgl-resources/cold-clone/report.json` and `acceptance/receipt.json`;
  cold receipt SHA-256 `02bffa033604a70e703db734dbd1d4b004ec525fea036fb247448c0a16d478d1`.
  The scrubbed exact-head clone starts and finishes with empty Git status, using
  a fresh npm install. Its retained location is recorded in the report; cold log
  SHA-256 `de5d27069893d7501e1781ccf108cf566c5cead2f72fef9632f48b50ee67e0e1`.

This proves the isolated resource/transfer boundary. Draw/state execution, guest
memory transport, asynchronous queue/fence acceptance, production capsets and any
FPS or desktop-acceleration claim remain gated by their later tasks. Production
web/Rust/Wasm surfaces and shader compiler were not changed. Fresh independent
verification must judge the evidence and remaining defensive coverage waivers.

### 2026-10-03 — fresh verifier — VERDICT: verified

VERDICT: verified

- P1 provenance/cold clone — HELD. Read task/diff and wrote predictions before
  evidence. Independently recomputed 251 source, raw/decoded input, served-byte,
  record, screenshot and cold-clone checks (`verifier/audit.json`). Worker and
  cold receipts match the frozen `fadf4ba8` sources; retained clone independently
  reports the exact head and empty status. Final attacks at evidence-only
  submission `b52c2cbd` use identical implementation/harness bytes.
- P2–P4 actual transfer bounds — HELD. Original snapshot events 156/157/160,
  offsets zero and 64/12/16 selected bytes match actual GL objects; logical GPU
  bytes remain 4188 versus 1064960 backing bytes. Node/browser results agree and
  hardware browser errors are empty (`worker/hardware/report.json:1215`). Overflow,
  overlap, invalid format/level, short IOV and logical-buffer errors reject.
  Five independent seeds produced 8192 deterministic mutations/recoveries:
  2474 accepted, 5718 rejected (`verifier/attacks.json:417`). Pinned reference
  source confirms COPY validates the GPU box and secondary staging IOV range.
- P5–P7 identities/lifetimes/budgets — HELD. Prepared snapshots resist backing
  mutation; revoked/replaced backing, memberships and numeric generations reject
  before GPU calls. Foreign/single-use tokens reject; public unref retains leased
  real storage and final release deletes it. All counters return to zero. Trusted
  allocation-fault injection proves scratch rollback without ticket/reference
  publication (`verifier/attacks.json:1675`, `:1686`).
- P8–P10 contamination/state/failures — HELD. All 12288 comparison-output bytes
  are poisoned without changing original uploads; genuine texture/index input
  corruptions fail the independent GPU oracles (expected 255/observed 254 and
  expected 0/observed 1). Hostile GL state, index buffer classification, byte-view
  mutation/rejection, backend faults and actual disposal remain correct.
- P11 coverage — HELD. Exact-source Node/CDP counters plus independent fault
  probes cover all 81 runtime functions and all detailed V8 ranges; no uncovered
  runtime span remains (`verifier/audit.json`, coverage result). Per-file audit
  and diagnostic/declarative harness waivers are in `verifier/review.md`.
- P12–P13 novel attacks/sabotage — HELD. Independent direct framebuffer oracles
  pass 72 varied rectangle/stride/offset/SG round-trips across both transfer
  variants with 3424 assertions and no browser errors (`verifier/attacks.json:584`).
  Temporary runtime mutations of default stride and membership revocation each
  fail their intended assertion (`:447`). Worker and verifier captures were
  visually inspected.
- SUITE: retain `make verify-E6-T12b`, promote the reproducible independent
  `verifier/attack-cases.mjs` and `verifier/run-attacks.mjs` regression artifact,
  and retain the original-byte and runtime-sabotage controls. No implementation
  code changed during verification. This verdict covers isolated GPU resource
  storage/transfers only; guest activation, draws, fences and FPS remain gated.

Commands: `node evidence/virgl-resources/verifier/run-attacks.mjs`;
`python3 evidence/virgl-resources/verifier/audit-evidence.py`.
Independent attack report SHA-256
`8637975189bfc27a510d08c8ac6f02d6a13ba2820862a866ded61fa496dcaf31`;
audit SHA-256 `cb2e5708314805444727eca420bd7bab4907999aac853c117b702ff27876ac02`;
coverage SHA-256 `20aae27ce8081dd1f65cff20560fc92b447a298ce121ee5549ed595e2c42fe95`.
Detailed predictions, per-point citations, coverage and limitations:
`evidence/virgl-resources/verifier/review.md`.
