---
id: E6-T11d67
epic: 6
title: Provide real four-sample rendering and original VirGL resolve
priority: 525.027035
status: verified
depends_on: [E6-T11d66]
estimate: S
risk: high
capstone: false
---

## Boundary

Qualify actual four-sample WebGL2 renderbuffer storage, admit bounded production
2D color/depth attachments with samples 2 or 4, and execute original VirGL BLIT
resolves through owned native framebuffers. Preserve prior single-sample proof
profiles. Count native sample allocation bytes, reject unsupported shapes and
formats before effects, and retain both resources through GPU fence completion.
Raise MAX_SAMPLES to four only with physical qualification and executable proof.

## Deterministic acceptance

`make verify-E6-T11d67` records original resource-create, surfaces, clear/draw,
BLIT and readback with actual four-sample native storage. Independent expected
resolved color/depth and partial edge coverage must match. The actual guest
GLES numeric probe must report MAX_SAMPLES >= 4 without any below-floor limit.

## Adversarial verification

Fresh verifier attacks one-beyond sample counts, unsupported targets, mismatched
attachment samples, signed boxes/format reinterpretation, allocation overflow,
unref/destroy during an in-flight resolve, and context loss. Sabotage sample
allocation or native resolve and require pixel/guest probes to fail. Preserve
old profiles' refusal of multisample metadata.

## Verification log

### 2026-10-13 — worker — started from independent negative proof

The production integration parent is blocked on the original guest transcript
`target/evidence/critic-omarchy-gpu-ui-local07-03/numeric-guest.log`. Only sample
count failed the 29 independent GLES numeric queries; unsupported border/sRGB
extensions and desktop GL contexts were correctly refused.

### 2026-10-14 — worker — exact-head submission

Runtime and recorded source head: `3bb4ba9b93f19165cf61d4c2cea82f128430e1a6`.
This submission claims only the multisample storage, capability and resolve
boundary. The parent desktop integration remains blocked pending the separate
verdict and still needs its scanout orientation correction and actual shell
rendering proof.

Commands (all exit 0):

```sh
VIRGL_GUEST_IMAGE=target/virgl-production/image-11 \
VIRGL_MULTISAMPLE_EVIDENCE_DIR=target/evidence/production-multisample-frozen-03 \
VIRGL_NUMERIC_EVIDENCE_DIR=target/evidence/production-numeric-frozen-03 \
VIRGL_MULTISAMPLE_DEMO_EVIDENCE_DIR=target/evidence/production-multisample-demo-frozen-03 \
make verify-E6-T11d67
python3 tools/virgl-production/cold.py --task E6-T11d67 \
  --output target/evidence/production-multisample-cold-02
node tools/publish-omarchy-chunks.mjs target/virgl-production/image-11/manifest.json \
  --publish --bucket wasm-vm --receipt-dir target/evidence/production-image-publication-11
```

The selected submission passed format/clippy gates, 389 core library tests,
12 original-MMIO critic tests, the pinned 1408-byte C ABI oracle, the wasm target
and the three hardware schedules. Actual native two/four-sample storage,
literal resolved color/depth and partial edge pixels, fences and owner cleanup
were recorded. Real Mesa in the production Linux worker passed all 29 numeric
limits, all 15 required multisample renderbuffer formats and its original
clear/blit/readback probe. MAX_SAMPLES is four; multisample sampling and public
desktop OpenGL remain refused. The ordinary built demo passed 127 tests with
zero failures or console errors and no proof exports. The pristine ordinary
full-history clone rebuilt the deployable bundle and repeated the acceptance
using the public R2 manifest/chunks, with scrubbed build/proof environment.
The earlier shallow-clone attempt failed before acceptance because it omitted
the historical source commit that the documentation corpus explicitly cites;
the final ordinary clone above is the portability proof.

Evidence of record is packaged in
`evidence/virgl-production-multisample/worker/exact-head-submission-and-cold.tar.gz`
(SHA-256 `25b952d8ec57e71a986005cc6c05a740dbde30714daa0dd65344a85db41406f2`),
with 124 exact file identities in the paired JSON. The hot report is
`88a80f8ff00e8762efe40843cab252c3881f9d6d6dc3736dfd9749e857efa990`,
the cold report is
`31abfc992eee7e27558df4a9436bc50f743873efc8127cb78326551e3dbfd6d7`,
and the guest numeric result is
`7a02630ef19fc0b06644714b37393d6757ed0887e4075eb07902b8a1588fc2fd`.
The published guest image is
`da086b8ac8ec3a28044eccb63abc66eac66eb08801b63c194ea229fd7cc9263d`,
manifest `e7e143cb9fc738643ecc09b9f1689d50e8755431788f02309a9ac7a9ba03a564`.
Publication verified 10527 existing objects and uploaded eight new objects plus
the immutable manifest; its receipt is included. This is an artifact
publication, not a claim that the unfinished parent is deployed or verified.

### 2026-10-14 — fresh verifier — VERDICT: verified

Reviewed runtime head `3bb4ba9b93f19165cf61d4c2cea82f128430e1a6` against
`8f502340`, the worker claim, exact recorded source identities and sealed
hot/cold evidence. The later worker-log commit changes no runtime source.
This verdict covers D67; the parent still needs correct production scanout
orientation, rendered default desktop shell, and its final deployment proof.

- **HELD — physical samples and independent pixels.** Predicted native requested
  samples 2/4 equal actual storage, magenta clear resolves exactly, Z16 0.75
  stays within one UN16 step of 49151, and triangle edges mix channels without
  changing opaque alpha. `critic-production-multisample-final-10/run-0000.json.gz`
  records 19631 assertions, 89 original requests, all seven exact native sample
  allocations, eleven literal mixed edge pixels, RGBX opaque alpha, signed
  single-sample/scissored copies, stencil-only and combined depth/stencil copies.
  Guest state digest `7ebf0cf5ee4e84dbfe4ac15ee1f6644d1670064b2bb10f3c5d708de7a8e13a3f`.
- **HELD — admission and no-effects refusals.** Predicted unsupported sample counts,
  shapes, overflow, attachment mismatch, format reinterpretation, Z32 stencil,
  and multisampled BLIT destinations refuse before allocation/binding/copy.
  The promoted original-MMIO native test and independent final10 records hold;
  the two independently found stencil/destination errors are fixed in this
  head. Historical profiles still refuse samples 2/4 (59 assertions). The exact
  32 MiB native budget and one-row overflow pass/fail boundary is held.
- **HELD — ownership and loss.** Predicted original queued destroy/unref waits for
  physical completion. Final10 records retained resources through the real
  fence and zero owners after cleanup. Its separate `run-0002.json.gz` injects
  actual `WEBGL_lose_context` while original BLIT holds both resources and a
  native sync: 1529 assertions, uncertain completion, original used-head
  retirement, zero holds/syncs/renderbuffers. Digest
  `975b7b01e08be360a868ce0136085f8d63d52bd1e512a9a32b5eaafe71485062`.
- **HELD — new failure cleanup.** Predicted negative hardware qualification cannot
  return a positive result and restores bindings/write masks. The promoted
  failure-cleanup final04 recording covers below-four samples, null temporary
  framebuffer/renderbuffer, wrong actual samples, incomplete FBO, bad real
  readback pixels and native error. Original resource-create failures cover
  unsupported native sample query, null renderbuffer and an exception after
  real native allocation; all leave metadata/budgets unchanged and no live
  owners. Owned multisample storage also refuses sampler/scanout leases. All
  ten cases pass; report SHA-256
  `cedf4e1885fb17534deee1b249cac5db1e5dc103a48c03b24af9deb771d9b9e3`.
- **HELD — truthful guest and clean build.** Authenticated all 124 worker sealed
  identities and 61 cold recording files. Exact-head ordinary full-history
  clone, build and acceptance exit 0 with scrubbed build/proof environment;
  public immutable image11 supplies the guest. All 29 numeric floors, all 15
  required real renderbuffer allocations, and actual Mesa clear/original
  BLIT/readPixels pass. MAX_SAMPLES=4; texture-MS and public desktop OpenGL
  remain absent. The ordinary built demo passes 127/0, no errors/proof exports.
  The shallow-clone diagnostic is superseded by successful cold02, not counted
  as proof. Its report is
  `31abfc992eee7e27558df4a9436bc50f743873efc8127cb78326551e3dbfd6d7`.
- **HELD — sufficiency and sabotage.** `verifier/audit.py` authenticates recordings,
  verifies current runtime digests, and confirms execution of all 179 added
  executable JavaScript lines across hot, cold and independent fault recordings.
  Rust gates/C ABI tests exercise sample accounting and typed mask fields;
  the actual patched Mesa profile exercises attachment-only capability queries.
  Types/comments/generated copies/docs/test-only CSR-stub harness fixes are
  classified in `final-audit.json`. In an isolated served copy, omitting only
  native original BLIT immediately changes the first expected magenta pixel
  to zero and fails. Later fixes change refusal guards only; its sabotage result
  is carried with unchanged native resolve/oracle dependency digests.

**SUITE:** retain the original-MMIO sample accounting regression, literal
physical pixel/lifetime/loss fixtures, independent GLES probe, failure-cleanup
mode, and `make verify-E6-T11d67`. The new recurring negative command is:

```sh
node tools/virgl-production/critic-fast-boots-multisample-browser.mjs \
  --mode failure-cleanup --output target/evidence/critic-ms-failure-cleanup
python3 evidence/virgl-production-multisample/verifier/audit.py
```

Independent recordings are sealed in
`evidence/virgl-production-multisample/verifier/independent-multisample-and-cleanup.tar.gz`
with paired file identities. Archive SHA-256: `7a3d49a245b19e813cb209eac4907c7ca9251b9dcd11754124e3b4b1c3862d93`.
