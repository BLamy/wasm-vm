---
id: E6-T11d16
epic: 6
title: Lower original dimensional constant banks to native uniform blocks
priority: 525.02703900034
status: in-progress
depends_on: [E6-T11d15]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicit host-selected C/Wasm compiler boundary, followed by a separate original resource-binding task. Accept original dimensional TGSI CONST[slot][vector] in VS/FS, static slots0..12 and user blocks up to1024 raw uvec4 vectors. Plain CONST and dimensional slot0 share the existing512-vector bank. Reject indirect dimensions, undeclared direct reads, duplicate user-bank declarations, overlapping slot0 declarations, malformed extents and out-of-limit dimensions before upstream parsing. Dynamic vector addressing stays on the GPU and preserves original address offsets; undefined indices retain native GLES3 semantics.

Provide separate explicit buffered stage/pair entry points and a strict host-selected JS factory. Keep all existing stage/pair/typed/packed entry points byte-for-byte compatible. User slots1..12 always emit named std140 raw uvec4 arrays. The pair selector composes the four proven vertex format masks with a two-bit resource-backed slot0 selector; only stages declaring slot0 may select it. Emit slot0 as the existing uniform array by default or a native std140 array when selected. Canonical block metadata specifies stage, original slot, member name/type, vector count, raw-word encoding, array stride16/offset0 and total block size. Keep program-owned VirglBlock656 separate. The buffered facet has a distinct metadata profile and guestUniformBlocks field; native reflection may eliminate unused declared blocks and must later distinguish that from missing active bindings. New metadata admission is explicitly selected; old normalizers/factories cannot silently acquire this capability. No CPU shader execution, numeric certificate, post-emission source rewrites, resource binding, caps or guest activation.

Use bounded per-slot declaration bitsets rather than a large byte matrix, preserve fixed16MiB Wasm memory and262144 stack. Cross-check original TGSI/vrend uniform-block metadata against independently validated declarations. No upstream source patch or guessed enum.

## Deterministic acceptance

`make verify-E6-T11d16`

Actual native, ASan/UBSan and generated Wasm calls agree on complete source and metadata. Cover both stages, all12 user slots, first/last vectors, 16KiB blocks, multiple simultaneous banks and full-limit combined VS/FS programs, independent raw-word/NaN/sign/mantissa values, static and offset/dynamic vector reads, sparse valid ranges and undeclared holes, dimensional/plain slot0 aliases and ordering. Compose signed/unsigned integer and signed packed scaled/normalized inputs with buffered slot0 in each stage. Vary host selectors on identical full sources and prove old selector/default output isolation.

Run actual headed M4 Metal programs made from the new C output. Bind full original buffers through reflected native block ranges in the proof harness; no production packet consumer in this task. Compare complete independently constructed pixels and direct words, full GPU storage and native member/block reflection. Exercise all simultaneously active banks, actual minimum16KiB storage and high slots12 for both stages. Independently corrupt a block word, block range offset and host-selected slot0 variant; require completed hardware draws/fences before original pixel assertions fail.

Fail every genuine new allocation site, record exact recovery, prove both original sources owned before semantic allocation, and cover null/oversized/malformed selectors and strict facade getters/proxies/mutation, separate memory and fixed-memory OOM/recovery. Measure optimized Wasm call-chain stack against the fixed bound. Record full LLVM/V8 counters bound to source/served/generated/blob custody. Run the affected existing standard compiler and four-mask/typed gates once at frozen head, one final exact-head scrubbed pristine clone, seal evidence and submit to a fresh critic. Old sealed unchanged proofs carry by code/dependency/evidence digest. This isolated prerequisite remains outside the reachable demo until qualified production wiring.

## Adversarial verification

Predict original slot/vector token indices, raw words and all native block/member sizes, offsets and strides before inspecting. Authenticate complete C/native/Wasm/served sources and final cold clone. Attack dimensions0/1/12/13, vector ends511/512/1023/1024, sparse/duplicate ranges, dynamic offset extremes and indirect dimensions. Probe both-stage slot0 variants, masks/metadata/factory isolation, full-limit native block concurrency and fixed-memory recovery. Cover all executable added regions, carry unchanged HELD proofs, invent one bounded hardware attack and sabotage promoted pixel assertions after completed draw/fence. This verdict cannot qualify production resources, API/caps or guest execution.

## Verification log

### 2026-10-10 — worker — planning at verified predecessor

E6-T11d15 is independently verified at `e118e4c2ddf83b2641fcca267025b1a6ef8fdad9`; its critic explicitly released the branch/index/source lease and its verdict is published in open PR491. The verified-head record `evidence/virgl-production-readiness/standard-uniform-buffer-gap.json` (SHA-256 `23b3bbb5c4a40c190292db9053ce827aaaf5ad19fe40fcbcbff70ba25ee34409`) binds 371 renderer/generated source identities and original Mesa26.2.2 source/archive pins. Actual fixed-memory Wasm rejects dimensional slots0/1/12 in both stages; original opcode27 returns unsupported-command, and original constant-buffer resource binding64 rejects. Reproduce by passing each recorded programs entry `{stage,text}` to `createVirglStandardShaderBridge().translate`, packetHex bytes to `decodeStandardSubmission`, and resource metadata/fields/backingBytes to `computeTransferLayout`. This literal negative justifies the ordered shader prerequisite; it does not qualify resource bindings, production caps or guest execution.

The user's instruction to finish production guest graphics keeps this S/high shader boundary ahead of unrelated work. Resource retention/binding and index/data storage aliasing are ordered successors. Existing old entry points remain isolated.

Primary sources: original dimensional token parsing is vendor/src/gallium/auxiliary/tgsi/tgsi_text.c at969/1352; original converter user-bank handling is vendor/src/vrend/vrend_shader.c at1946 and4871 and independent ubo_used_mask export. Mesa26.2.2 virgl_set_constant_buffer sends opcode27 for every nonnull GPU buffer includingCB0, and opcode12 for inline/unbind. ES3.0.6 table6.33 and section2.12.6.2 require native UBO minimum storage and bounds; primary specification https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf. Later bindings may not copy between WebGL element-array and other-data classes; that is explicitly forbidden by https://registry.khronos.org/webgl/specs/latest/2.0/#5.1 and needs a separately proven mirrored-upload/retained transfer adapter.


### 2026-10-10 — worker — activation

Selected as the first eligible Next up entry after the verified D15 dependency. Native stack branch `codex/virgl-standard-uniform-shader` was added after publishing the critic verdict. Runtime/claim scope is the one original dimensional constant-bank compiler boundary above. The separate retained resource-binding prerequisite follows fresh verification of this shader layer.
