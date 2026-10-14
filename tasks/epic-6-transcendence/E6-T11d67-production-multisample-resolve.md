---
id: E6-T11d67
epic: 6
title: Provide real four-sample rendering and original VirGL resolve
priority: 525.027035
status: implemented
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
