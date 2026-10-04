---
id: E6-T12g1
epic: 6
title: Capture unmodified guest es2gears and inventory required resource/view packets
priority: 525.0270101
status: implemented
depends_on: [E6-T12f6]
estimate: S
risk: high
capstone: false
---

## Boundary

Pin the official Mesa demos source archive, cross-build its unmodified
es2gears Wayland client against the immutable guest sysroot, and capture it
through the existing real RISC-V/Mesa/VirGL reference pipeline. Close the actual
client window through compositor IPC and require its real zero exit; a watchdog
kill cannot count as completion. Preserve source/build/library/binary/recorder
and guest BEGIN/END provenance, every submission and backing snapshot. Keep the
four old captures and nineteen-hash shader claim immutable.

Derive the kmscube and es2gears client requirements directly from authenticated
resource creates and original surface/view/sampler/transfer/draw packets, with
context/event/byte/digest citations. Separate supporting-compositor traffic from
the gears client. Record formats by role, flags/origin, channel order, swizzle,
levels/layers/targets/filtering, inline-write use and any new unchanged shader
bodies. This slice adds no renderer mapping, caps or performance claim.

## Deterministic acceptance

`make verify-E6-T12g1` validates the complete committed real capture, pinned
unmodified workload inputs/build and client draw/exit provenance; reconstructs
its required-format/view inventory; rejects provenance/packet/output mutations;
retains the four old captures and affected recorder/framing regressions. Record
the actual guest run at frozen source and a final pristine-clone acceptance.
Report new shader admission or format gaps as requirements for later slices,
never as inferred browser support.

`make verify-E6-T12g1-variants` is the incremental synthetic decoder gate for
branches absent from both real clients. Record its packet/backing inputs,
independent assertions, state transitions, line hits and source-fault rejection
separately; it cannot add real-client requirements or rendering claims.

## Adversarial verification

Attack fake renderer/exit/FPS markers, early closure or timeout counted as
success, wrong workload binary/source pins, source-version substitution,
missing client draws, omitted snapshots, forged resource roles and damaged
packet blobs. Hold client-only inventory against literal protocol words and
ensure supporting compositor formats are not mislabeled client requirements.
The actual executed recorder remains unchanged unless separately scoped proof
is added. No rendered-pixel or browser-FPS claim is made by this capture.

## Verification log

### 2026-10-04 — worker — execution boundary

Verified shader parent is `3381977b27842437e6a675809374642059987854`.
This high-risk S slice captures and inventories one original workload. It adds
no format/shader/device implementation. Source/binary identity, real guest
completion and exact packet provenance are the acceptance boundary. Original
Mesa demos9.0.0 archive candidates are checked against the official SHA-256
before building; the rootfs/kernel and existing recorder stay immutable.
No mapping slice starts before this inventory is independently verified.

### 2026-10-04 — worker — sealed submission

Actual guest/controller/build source is frozen at
`a669aad01b93e03e3b528a931748d0800156e57c`; final evidence-checking source is
`928f4fb6e3ae4c134aca8fdd79a759045fbc877d`. The later supplement changes only
evidence, acceptance checks and future planning notes. The original builder,
controller, recorder, packet stream, resource inventory and source pins remain
byte-identical. Source tables in the worker archives bind both boundaries.

Executed commands (full compiler/QEMU argv and guest script are retained in
the build/capture manifests):

```sh
docker exec wasm-vm-virgl-reference-research python3 /workload-build/control/build_gears_in_container.py --rootfs /reference/omarchy.ext4 --archive /workload-build/inputs/mesa-demos-9.0.0.tar.xz --output /capture/gears-workload-a669aad0
docker exec wasm-vm-virgl-reference-research python3 /capture/capture.py --workload es2gears --gears-directory /capture/gears-workload-a669aad0 --output /capture/gears-capture-a669aad0 --timeout 150 --max-blob-bytes 1073741824
python3 tools/virgl-capture/workloads/build_gears.py --container wasm-vm-virgl-reference-research --cache /tmp/wasm-vm-gears-source-fetch-a669aad0 --output /capture/gears-workload-download-a669aad0
python3 tools/virgl-capture/validate.py evidence/virgl-workload-inventory/captures/es2gears --write --pack-blobs
VIRGL_WORKLOAD_INVENTORY_EVIDENCE_DIR=target/evidence/virgl-workload-inventory-worker make verify-E6-T12g1
# Expected failure: separately substituted immediate-zero RISC-V executable.
docker exec wasm-vm-virgl-reference-research python3 /capture/capture.py --workload es2gears --gears-directory /capture/gears-quick-zero-a669aad0 --output /capture/gears-negative-quick-zero-a669aad0 --timeout 150 --max-blob-bytes 1073741824
# Final pristine clone at 928f4fb6; inherited CARGO_*, RUSTFLAGS,
# RUSTDOCFLAGS, RUST_LOG, PYTHONPATH and PYTHONHOME removed.
VIRGL_WORKLOAD_INVENTORY_EVIDENCE_DIR=target/evidence/virgl-workload-inventory-cold make verify-E6-T12g1
```

Evidence lives in `evidence/virgl-workload-inventory/`. Capture manifest
SHA-256 is`202500d87a7e31a5c04f192852bb9a23dedce8681fb3ee4850e0738aee30e8a8`;
the complete no-drop recording has 52,809 events and 632,291,908 unique raw
blob bytes. Actual guest, QEMU, client and closewindow exits are zero. The
live executable hash is`59f4029a08b809f8d191cd7b3d719e2c5b09f0aadb97833f088b41fa60a918af`,
also reproduced by the independent-directory/fresh-download build. Client
context lifetime`6@4410` supplies 1,566 draws; supporting traffic supplies
29,025. Literal creates/draw roles require format233 B10G10R10X2_UNORM color,
format16 Z16_UNORM depth, and format64 buffer storage with vec3 vertex input.
Original kmscube requires format2 color, format67 sampling and format64 vertex
bytes. Channel spellings are recorded enum names; mapping remains unproven.

The immutable kmscube inventory SHA-256 is
`8a1fb71fdd3f4d4c3696104690e11af480e5f1b95634bd077a1fcef1636b7b8c`;
gears is`fb91301b9e14b098e0d8a590ddb7fa33ead15972195211741a5efcc3d58e9a3c`.
All four prior manifests and nineteen original bodies are unchanged. The new
full capture contains thirteen prior bodies plus two new client and four new
supporting-compositor bodies, bound separately in`index.json`. All six new
bodies remain unproven for shader admission and browser execution.

Original worker archive SHA-256 is
`fd2b5faf08ab77133937fa8d09183a24f16bfe2f88913ca4f08d2fbacc14e7dc`;
final cold archive under`worker/cold/` is
`155e1eb8a75cc790513d19abae489953952384df7900e4bd835c854a6dcc05d4`.
The clean clone passed with clean Git status before/after, 21 framing tests,
all five captures, byte-identical inventories, 42 rejected mutations, 27 native
recorder cases and its source-sabotage rejection. The separately sealed
negative archive`4d6d63999632fc23088343403aac4d54c3a0e7beb0dc4ab41a6af96ed595b257`
records actual client exit0 but guest exit1 and incomplete/workloadPass false,
despite 2,277 supporting draws. Its 2,806-event recorder session is itself
complete/no-drop; acceptance rejects the workload rather than its framing.

This proves only unchanged guest-client completion, packet/backing provenance
and reproducible requirements. No renderer, emulator, wasm or demo code changes;
broad Rust/wasm/browser gates do not exercise this tooling boundary. No rendered
pixels, new shader admission, format support, live offload or MIPS claim is made.
Fresh adversarial verification is still required.

### 2026-10-04 — fresh verifier — VERDICT: needs-evidence

VERDICT: needs-evidence. The unmodified guest completion and literal client
inventory claims were not contradicted. New executable inventory branches
remain unexercised; they require the bounded decoder proof below before this
task reaches verified. No implementation code was edited by this verifier.

- P1 authentication — HELD. Predicted every seal/member/source binding would
  authenticate. All 143 original-worker, 148 cold-worker and 198 negative
  archive members do, as do the positive capture/artifact/blob digests and
  all frozen/cold Git source tables. Capture digest remains
  `202500d87a7e31a5c04f192852bb9a23dedce8681fb3ee4850e0738aee30e8a8`.
  Citations: `target/evidence/virgl-workload-inventory-verifier/authentication.json`,
  `worker/manifest.json`, `worker/cold/manifest.json`, `negative/manifest.json`
  under this evidence directory. Preserve these exact boundaries.
- P2 immutable inputs and new shader separation — HELD. All four old captures,
  recorder source/build and nineteen old bodies remain byte-identical to the
  verified parent. Two new client and four new supporting bodies remain separate
  and unproven for admission/rendering (`index.json` and the canonical gate).
  Current generated scripts for all four old workloads are byte-identical to
  their retained guest scripts (`legacy-driver-compatibility.json`).
- P3 source/build/live identity — HELD. An independent fresh read from the
  official archive URL matched 14,839,368 bytes and `3046a3d2…496b`. A fresh
  container compile, after independently checking all 12 source files,
  12,153 sysroot bindings, compiler digest and package versions, reproduced
  `59f4029a…18af`. The live executable, PID176, comm, mapped library hashes,
  VirtIO render descriptor and actual 300×300 window agree. Citations:
  `official-source.json`, `build-replay.log`, captured `gears-executable.sha256`,
  `gears-library-hashes.txt`, `gears-fds.txt`, and `gears-clients.json`.
- P4 normal completion — HELD. Predicted positive original reports followed
  by successful actual window closure and zero client/guest/QEMU exits.
  Captured `workload.log:8-9` reports 158 and 196 frames over 5.0 seconds;
  `gears-control.log:3-7` records rendered/resized/identity 1 and close/client 0;
  `guest-serial.log:238,251` bounds the successful guest run. The independent
  sealed early-zero run still rejects despite client 0 and 2,277 supporting
  draws. The unchanged upstream Wayland close handler sets `window.open=false`
  after native teardown; no synthesized renderer/exit/FPS output was added.
- P5 literal joins and supporting separation — HELD. Independent replay
  authenticated all 8,533 gears client packets, 532 client objects, and 1,566
  draw bindings, plus all 147 kmscube packets/16 objects/48 draws. Earlier
  `6@192` Hyprland contributes no client state; only `6@4410` is selected.
  Real gears creates at `events.jsonl:4414,4425,5010` bind formats 233 color,
  16 depth and 64 vertex bytes; the first draw at event 5115/byte 6484 binds
  their original objects and vec3 input. Its packet digest is
  `f290d0bda70b54295557d81d930705905da73f8ffda8c50f9f6bca22a8190a1f`.
  Kmscube event 176/bytes 4400,4444 proves its format 67 view and sampler words.
  `literal-audit.json` records every checked lifetime/citation. The two inventory
  digests remain `fb91301b…9a3c` and `8a1fb71f…7b8c`.
- P6 backing/framing and scoped gate — HELD. The canonical gate passed at
  `1b2cbf44`: 21 framing tests, all five complete captures, both identical
  inventories, 42 rejected mutations, 27 recorder cases and recorder sabotage.
  Positive `events.jsonl:52809` has openCalls 0, droppedRecords 0 and
  632,291,908 unique blob bytes. Every required submit backing is present.
  The cold archive authenticates source 928f4fb6 and clean Git before/after;
  its checking source is byte-identical to current. Keep this proof; no
  unrelated Rust/wasm/browser/deployment suite is demanded.
- P7 independent attacks and new assertion sensitivity — HELD. A well-framed
  kmscube view mutation changed only the G swizzle to ONE(5); literal decoded
  lanes became [0,5,2,3] and original inventory equality rejected it while 48
  draws remained. Aliasing the new named client to still-live compositor
  context 5 rejected at event 4410 as `overlapping context inventory lifetime`.
  Disabling the new comm assertion in a scratch source copy made the new
  acceptance harness fail exactly at `wrong-client-comm`. Citations:
  `independent-attacks.json`, `attacks-coverage.log`; original source digest
  `df323c77…eb4d`, fault digest `81cbdd4d…ca18`.
- P8 executable branch sufficiency — NEEDS EVIDENCE. Predicted every changed
  decoder behavior would execute or be non-runtime metadata. Line hits plus
  an independent opcode/object/draw recheck show the following are absent
  from both actual clients. Record a synthetic literal-packet decoder suite
  with independent field/role/digest assertions, explicitly separate from
  real guest use and rendering:
  - `inventory.py:139`: buffer-target SAMPLER_VIEW first/last elements.
  - `inventory.py:147`: MSAA_SURFACE word 6 sample count and surface lifetime.
  - `inventory.py:166`: incomplete shader packet creates no completed object;
    the final continuation installs the exact joined body/stage/handle.
  - `inventory.py:221-223,291-292`: index bytes/offset/resource, indexed draw
    role, zero unbinding and missing-resource rejection.
  - `inventory.py:231-233,301-302`: uniform stage/slot/offset/length/resource,
    draw role and zero unbinding without borrowing another slot/context.
  - `inventory.py:255-258`: selected-client COPY_TRANSFER3D source/destination
    lifetimes, source offset/flags and both latest backing citations.
  - `inventory.py:260-261`: RESOURCE_INLINE_WRITE exact payload byte count/hash
    and literal level/box/stride citation.
  - `inventory.py:370-371`: reset and cleanup clear live tables; reused numeric
    IDs acquire fresh lifetimes and cannot inherit old state.
  Citations: `coverage.json`, `coverage-recheck.json` and original event footer
  line 52809 (`cleanupSeen=false`). These are executable behavior, not waived
  merely because the recorded clients do not need them. Declarative tables,
  imports/definitions, task planning metadata and logging are explicitly waived.

Commands: scrubbed-env `VIRGL_WORKLOAD_INVENTORY_EVIDENCE_DIR=target/evidence/virgl-workload-inventory-verifier/acceptance make verify-E6-T12g1`;
`python3 target/evidence/virgl-workload-inventory-verifier/literal_audit.py`;
`python3 target/evidence/virgl-workload-inventory-verifier/attacks_and_coverage.py`;
independent official fetch and scrubbed-environment compile recorded in
`official-source.json` and `build-replay.log`. All verifier scratch artifacts
are under `target/evidence/virgl-workload-inventory-verifier/`; `report.json`
binds their digests and lists the exact source/evidence boundaries to carry
forward. SUITE: preserve the canonical target and add the missing scoped
decoder proof; no fresh guest boot or repeat cold clone is needed if only
tests/fixtures/recording evidence change and these HELD boundaries stay intact.

### 2026-10-04 — worker — incremental decoder evidence

Supplement source is frozen at `cfbe69fae8fc1b4befe85785d186a4449144f961`.
Only fixtures, recording/acceptance scripts, Makefile routing and documentation
changed. The inventory, framing validator, real guest controller/builder and
source pins remain byte-identical to the critic's HELD boundary. All eight
retained evidence digests are recorded unchanged in `worker/variants/manifest.json`.
The initial critic archive is sealed separately under `verifier/initial/` with
SHA-256 `0ce29d3b8e2f6911eeff48e6ecf3aa123b8b14981bea55473bb0b5282edd438a`.

With inherited Rust/Cargo/Python overrides scrubbed, recorded commands were:

```sh
python3 -m py_compile tools/virgl-capture/tests/inventory_variants.py
bash -n tools/verify-virgl-inventory-variants.sh tools/verify-virgl-workload-inventory.sh
python3 -m unittest discover -s tools/virgl-capture/tests -v
VIRGL_INVENTORY_VARIANTS_EVIDENCE_DIR=target/evidence/virgl-inventory-variants-worker/acceptance make verify-E6-T12g1-variants
```

All passed, with clean tracked Git state. The supplement archive is
`worker/variants/recording.tar.gz`, SHA-256
`4b30d21ff2e39ed54fedabe2e966140a84043676b8682ab9ada98e739c4a5c41`;
its 225 members preserve seven complete balanced synthetic API sessions,
literal packet/backing bytes, independent field/lifetime assertions, shader
assembler outputs, inventory results, state observations and per-case line
hits. The 66 assertions cover all eight requested decoder boundaries; the
index/uniform rejection cases also require exact errors. Reused resource ID 6
without an IOV cannot inherit its prior lifetime's backing. A scratch source
fault changes index offset 19 to 23 and fails precisely the independent literal
binding assertion. The 21 existing framing tests still pass.

These are synthetic decoder checks only. They add no real-client requirement,
GPU execution, renderer admission or offload claim. The canonical G1 target now
includes the narrow gate. As the critic prescribed, the unchanged actual guest
and final pristine-clone proofs are carried forward rather than rerun. Fresh
incremental verification of the missing sufficiency evidence is required.
