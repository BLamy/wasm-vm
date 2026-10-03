---
id: E6-T12e6a
epic: 6
title: Enforce compiler constant-domain contracts at shared draw issue
priority: 525.02699061
status: implemented
depends_on: [E6-T12e6]
estimate: S
risk: high
capstone: false
---

## Boundary

Before admitting new numeric CONST shaders, enforce one versioned stage-local
finite-binary32 constant-bank contract in the shared synchronous/asynchronous
renderer. Check the same immutable current raw words that the draw uploads.
Unknown, malformed, stripped or inconsistent conditional metadata must reject
before dispatch. Preserve existing unconditional profiles and full results.
No new compiler admission, wire transport domain or production negotiation is
claimed by this consumer-only slice.

Cover every active uploaded word of the existing slot-zero bank. Preserve
completeness independently of finiteness: a shorter replacement bank must not be
completed with restore's temporary zero defaults. Respect declared/reflected
extents, the 46-register guest address limit and existing extent-47 declaration
quirk. Finite includes signed zero and subnormals; reject exponent-all-ones words
using their u32 encoding without coercion or normalization. Existing decoder
Inf/NaN rejection stays intact.

Bind selected shaders/program generations, subcontext identity and checked banks
to the same bounded draw plan. Reuse existing ownership and busy-lock rules.
After an async yield, either upload exactly the checked immutable snapshot or
reject a changed identity. Restore external GL bindings with the checked values.
Rejected contracts/words must produce zero draws and unchanged framebuffer data.

## Deterministic acceptance

`make verify-E6-T12e6a` records metadata/predicate tests and real synchronous and
yielding asynchronous renderer draws with independent whole-frame and uploaded-
word oracles. Cover both stages, CONST45, sparse uses, bank replacement/shortening,
A/B/A subcontexts, handle reuse, bound-state restoration, zero/normal/subnormal
words and rejection recovery. Any metadata wrapper is an explicitly identified
trusted host contract harness, not a guest compiler capability claim.

Run real invalid wire inputs through the normal decoder (zero applied commands),
then source-bound decoder-finite-check sabotage so the same Inf/NaN payloads
reach the new guard and still produce zero draws. Preserve affected state,
constants and async regression gates. Record exact-head evidence, repeated
varied async schedules, one final pristine clone and a fresh verifier verdict.

## Adversarial verification

Attack wrong stages/names/kinds, duplicate constraints, inconsistent profile,
missing contract, oversized extent, stale finite proof after bank replacement,
short-bank zero filling, external GL rebinding and state mutation during async
yield. Remove or bypass the new guard and require an independently measured
invalid upload/draw or framebuffer contradiction. Confirm subnormals remain
unaltered in the raw channel and are not accidentally rejected as nonfinite.

## Execution notes

The consumer recognizes `virgl-webgl2-raw-bits-v7` with one
`constant-bank-finite-f32-v1` stage-local constraint. The declaration extent is
1..47, while the checked upload remains the reflected prefix capped at the
46 addressable guest registers. Existing unconditional profiles retain their
metadata and restoration behavior.

The shader bridge is a trusted host capability. A stripped-contract attack
retains v7, and a relabelled-profile attack retains the constraint. Removing both
markers from a previously accepted unconditional result is indistinguishable
from that required legacy result; this slice does not authenticate arbitrary
host metadata or infer contracts from GLSL text.

The shared non-draw restore path skips incomplete/nonfinite conditional uploads,
preserving command-prefix CPU state. The strict draw plan validates both stages
before index readback and binds immutable checked prefixes to selected identities.
Under the isolated decoder bypass, SET may therefore store an invalid bank; the
following DRAW must reject without uploading it. Normal wire rejection remains
atomic at predecode.

The final gate replays the affected constants, state, resources, draw and async
workloads. Their existing independent oracles remain authoritative. The historical
E3b top-level receipt pins a much older compiler, so a named successor compatibility
receipt compares complete legacy translations while preserving that historical
receipt's policy. Compiler semantics are unchanged from verified E6.

## Verification log

### 2026-10-03 — worker — implementation and recorded submission

Frozen source: `32509356c18af1c18e59bf14375f4402b434bd7d` (parent verified E6:
`5561bf3d8a16d2e847b7772909bf772f2c8c57d5`). This consumer-only change adds
strict raw-v7 metadata validation, a bitwise finite-binary32 domain and immutable
constant snapshots bound to the selected shared renderer identities. Non-draw
restoration skips incomplete/nonfinite conditional uploads; normal predecode
and unconditional restoration preserve their earlier behavior. Compiler source,
guest transport and production negotiation are unchanged.

Commands:

- `node --check` for changed runtime/harness modules; `python3 -m py_compile
  tools/virgl-constant-domains/*.py`; `bash -n
  tools/verify-virgl-constant-domains.sh`; `git diff --check`.
- `VIRGL_CONSTANT_DOMAIN_EVIDENCE_DIR=evidence/virgl-constant-domains/worker
  EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc make verify-E6-T12e6a` — passed.
  This builds native/Wasm shader artifacts and runs the complete affected
  decoder/resources/state/draw/async workload, both async source controls, flat
  pair tests, retained constant tests and high-upload control before the new
  normal, decoder-bypass and combined-bypass recordings.
- `python3 tools/virgl-constant-domains/cold.py --output
  evidence/virgl-constant-domains/cold-clone` — passed.

Warm receipt: `evidence/virgl-constant-domains/worker/receipt.json`, SHA256
`2563c8497152ab17497c205edf8c78577e7b7cc34e566eef73915454615c0012`.
It binds 245 committed sources and 45 evidence records (48 files including logs).
The independent Python receipts reconstruct 1,549 predicate cases, 95 metadata
cases, 109 bank cases and four ownership cases; 14 real native/Wasm stage
translations; exact host metadata transformations and flat pair specialization;
all raw commands, selected identities, actual native shader attachments, uploads,
GPU readback, framebuffers and fence order. Every previous compiler source is
pinned to verified E6; 27 retained native outputs remain byte-exact to E3b/E6.

Normal hardware execution records 1,411 submissions, 3,367 commands and 612 actual
draws: 110,592 independently checked pixels and 64 reconstructed raw words,
including both signs of zero and subnormals at C0/C45 in both stages. It includes
28 malformed-metadata cases, 120 real invalid-wire cases, four varied yielding
schedules, ten lifecycle transitions and four busy-lock/external-binding attacks.
The 967 real fences include 1,452 deliberately withheld already-signaled polls;
no readiness is fabricated. Native reflection retains 46 entries for the low-use
program here, so the proof makes no claim of driver pruning. Unit evidence covers
every relevant inactive/pruned prefix rule. Declaration47 padding remains outside
all guest uploads.

With only the constant decoder finite check bypassed, 120 complete raw bad banks
are honestly stored in CPU state and their subsequent draws reject before index
readback/staging/dispatch, with zero invalid native upload and unchanged complete
framebuffers. Ten recovery draws check 10,240 pixels. Removing only the new
finite predicate's exponent condition then produces one observed native upload
of `0x7f800000`; `getUniform` independently reads back the same u32. This fault
witness is upload-only, with no exceptional numeric rendering claim. All runs
have zero browser console/page/request errors and complete owned-object cleanup.

Warm report digests:

- Node: `3ca5d637bcba3fd38f518be8cdb474670e17883ba4e4b7f8a1d9fd910d634bbf`.
- Native: `34ef80a97a8fa779a2e54516ef6923e7c1eb093c3665d1a03e1ed5c93fc7d8a3`.
- Normal GPU: `2a402e13d660648c441b97e18079b5f0f0e76d6fbe293ef19df7e711941998a1`.
- Decoder bypass: `d0b79bed15b09971f6692c55a363d2d42089b19472d811339063c9a5ad60606f`.
- Combined fault: `4c666d7112ecce2cb9f3fec0f937a863bb5a1dd4f7dfa23090081d5e3f55d853`.
- Screenshot: `e30747221be76c7aef7ae69d9353df1d7e35ec5c94b4f1ac260d40572d7d100e`,
  visually inspected (byte-identical to the reviewed final preview capture).

Native executable SHA256:
`6cc0045302f3cd52b5d99e7071e010b8569e8fa27f3aa39683927941bc6ec7df`.
Wasm SHA256:
`4287e738fe2653fe43f03aec2bade254855ea6e47f94451e5f3ad16f9adc01e7`.
The source-bound legacy adapter preserves the historical E3b receipt unchanged;
it independently checks 45,056 retained constant pixels, 114 pair cases/52 pair
draws, 210 original async packets/768 literal interior pixels and all 93 bounded
async rejection cases. No historical receipt is retagged as proof of this change.

Final pristine-clone run passed at the same frozen source, with empty Git status
before and after execution and all 48 copied acceptance files independently
rehash-checked. Environment scrubbing removed `GIT_PAGER` and `RUST_LOG`; the
remaining documented compiler/runtime override names were absent. Cold report:
`evidence/virgl-constant-domains/cold-clone/report.json`, SHA256
`d877a5c5d25bf88b68887d6a820658bc9a01e29d53c3cf85d4e4abe39be7f95c`.
Its receipt SHA256 is
`c910b5fac8ba5e11d2b0e8388268d9f6fbf2d1f5a4738b7fb4b1162d0e6563e6`;
its log SHA256 is
`c2adbd2a4578fcc1818294fc6b6ab9a5d01e60396a51fba2b8911eec9bf76814`.
The isolated retained checkout is named in that report. This recording repeats
the entire acceptance from source without relying on the warm build products.

The ordinary demo does not yet negotiate guest 3D, and this isolated consumer
proof changes no reachable production demo capability. No Mesa execution,
desktop FPS, or MIPS claim follows from this task. Compiler derivation is the next
gated layer, E6-T12e6b.
