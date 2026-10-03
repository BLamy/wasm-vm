---
id: E6-T11a
epic: 6
title: Connect validated virtio 3D context and resource control to the renderer
priority: 525.02696
status: implemented
depends_on: [E6-T12d]
estimate: S
risk: high
capstone: false
---

## Boundary

Add the transport/renderer interface and strict control-queue handling for
CTX_CREATE/DESTROY/ATTACH_RESOURCE/DETACH_RESOURCE, RESOURCE_CREATE_3D,
RESOURCE_ATTACH_BACKING/DETACH_BACKING and resource unref. Validate guest RAM
scatter/gather lists and the target/format/bind/dimensions/array/level/sample
fields before forwarding bounded resources to the verified renderer. Keep
transport ownership distinct from JS object/storage references and generations.
Use an explicit test-only negotiation fixture; production VIRGL/capsets stay
disabled until E6-T11d. A null sink proves transport only, never Mesa support.

## Deterministic acceptance

`make verify-E6-T11a` runs affected Rust format/lint/native/wasm builds and tests,
recorded guest command/response traces and the real browser renderer bridge for
valid context/resource lifecycles. Compare spec responses and state digests with
an independent packet oracle. Invalid resource IDs, duplicate attach, stale
generations and guest backing past RAM must return appropriate ERR_* responses
without panic or memory access outside validated bounds. Run final clean clone.

## Adversarial verification

Exercise creation rollback, ID reuse, context destruction while references
remain, backing-page overflow/alias/short lists and failed renderer allocation.
Do not treat nested reference-capture API calls as duplicate guest operations.
Preserve Epic5 two-dimensional control/scanout tests. No live guest 3D or UI
capability claim follows a test-only control-plane fixture.

## Verification log

### 2026-10-03 — worker — activated

Follows independently verified captured draw replay (`b9a28ccd`, PR #410).
This is the synchronous context/resource control boundary only. Add explicit
`virgl-control-proof` feature constructors and a proof-only Wasm queue fixture;
default device negotiation and capsets remain unchanged even in a proof build.
Validate complete bounded request/response spans, shared 2D/3D identifiers,
metadata and guest backing before issuing failure-atomic renderer events. Host
generations distinguish accepted resource identities from reused numeric wire IDs.
Unexpected callback failures poison the proof bridge until reset. Snapshots refuse
proof ownership before any restore mutation. Actual browser queue service must
invoke the real JS resource/state owners before guest completion; native trace
replay alone is insufficient. Selected high-risk gates include affected core and
Wasm format/lint/build/tests, existing 2D regressions, deterministic raw
command/response/state evidence, hardware renderer lifecycle attacks and final
scrubbed clean-clone acceptance. SUBMIT, DMA transfers, asynchronous fences,
scanout and production Mesa activation remain later ordered tasks.


### 2026-10-03 — worker — implemented

Runtime/harness head: `252b5eaba8135967c29938e7a5a4709c4d22473d`.
The final recorded commands were:

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_CONTROL_EVIDENCE_DIR=evidence/virgl-control/worker make verify-E6-T11a
python3 tools/virgl-command/control-cold.py --output evidence/virgl-control/cold-clone
```

The gate passed affected format/clippy checks, seven native control tests,
80 existing GPU unit tests, four GPU Machine regressions, six existing Wasm GPU
protocol tests, default/proof Wasm builds and the pinned shader bridge build.
`worker/native-control.log` records 139 nonportable command cases plus 27 shared
native/Wasm cases. `worker/native-browser-parity.json` compares their literal request,
24-byte response, descriptor/avail/used ring bytes, used index, canonical transport
bytes and SHA-256 digest exactly. Hardware acceptance ran 165 wire commands,
2,205 assertions and 129 attacks; actual allocations included 16 buffers, six
textures, 79 VAOs and 78 FBOs, with zero surviving GL objects. Deliberately skipping
renderer context creation failed at the independent `actual renderer context`
assertion. Browser errors were empty.

The recording demonstrates synchronous guest control completion only after actual
renderer ownership exists, strict bounded packet/metadata/RAM validation before
callbacks, separate transport/storage generations, retained storage after public
unref, context membership removal, ID reuse, rollback on expected allocation
failure, and reset recovery after uncertain callback outcomes. In particular,
apply-then-throw can leave a host generation uncommitted by Rust; reset changes the
epoch and resets the JS creation high-water mark so the legitimate retry succeeds.
Native snapshot tests prove refusal before outer Machine save/restore mutation,
including the direct desktop restore backend. Callback getters are not invoked;
malformed returns and thenables poison the transport. Host teardown fault tests
require poison, not fictitious rollback. No SUBMIT, DMA, asynchronous fence,
scanout, Linux Mesa or throughput claim is made by this control-plane fixture.

Evidence root: `evidence/virgl-control/worker/`. Receipt SHA-256:
`1ca99fe2a1b9ef5fb0d779a09749b3ad7170101b4578cef584b3528b296cc5c8`.
Hardware report SHA-256:
`ecc4d84a49eaeefd803505133834b5af8578e4bddca980e6e0fbb9e7152f71d6`.
Hardware screenshot SHA-256:
`6b19114e2fc6681611d08df25cb266b5cd624aefb6a8f17cba0f1edff84e735a`.
The receipt binds source files, generated proof Wasm/snippets, logs, CDP coverage,
raw parity records and screenshots. Images were inspected.

The final scrubbed clone at
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-control-cold-_v2r_th3/wasm-vm`
passed the same gate at the exact runtime head with empty before/after git status.
`cold-clone/report.json` SHA-256:
`206ca33b125f5201c7bc0eecc49e3aef57e7a2e7093e3dfb3bd0ad05245ad8f9`;
cold receipt: `8a5cb66d7144520e797a36a344729b7e08ea3ada82584ebaaf347928ddc6af9c`;
cold log: `8f81ae5397c9bcdda3233419ba88b5e9355f51a1d9fbb2acf798811e10e8d115`.

`make web-dist` rebuilt the ordinary artifact before the frozen commit; both the
Wasm and service worker changes are committed. The commit hook's redundant build
was bypassed only after that manual build and explicit staging. The proof-only
API is absent from this ordinary artifact, and default VIRGL/capsets remain off.
The ordinary built page passed 127/127 with zero errors and its existing scalar
memory capability pip live (`worker/default-demo/`). The test-hooks layout only
reveals the existing compliance panel; it does not change emulator semantics or
advertise the new isolated capability.

`bash tools/deploy-cloudflare.sh` published the ordinary bundle to
https://8774cb0b.wasm-vm.pages.dev and https://wasm-vm.pages.dev. Temporary deployment
manifest rewrites were restored to their committed bytes. A fresh live browser
load passed 127/127 with no errors, confirmed the proof export absent, and hashed
the actual fetched Wasm to
`75f405e190d96382f52d12906bd32f3ffdaf6ade3262438673c7f8e6d4ac0ed8`.
`worker/live-report.json` SHA-256:
`4c064973d89818a31b677fe30758408da4635c001d2bc64777f6fb64223ef852`;
`worker/deploy.log` SHA-256:
`c177c1ca4b345001263757c3f58f6b97c5879471787e797726491cc73c17b522`.
The live report also binds its screenshot. Independent verdict remains pending.
