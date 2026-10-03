---
id: E6-T12e2
epic: 6
title: Derive flat vertex-fragment interfaces from accepted shader pairs
priority: 525.0269902
status: implemented
depends_on: [E6-T12e1]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit CONSTANT interpolation on fragment GENERIC inputs, including unchanged
original `67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa`.
Expose interpolation requirements in checked metadata and derive the matching
vertex output qualifiers from the accepted fragment stage when translating and
linking a pair. Keep the externally supplied shader-key surface closed: the
pair interface is internally derived from bounded declarations, never supplied
as arbitrary guest compiler keys and never produced by editing captured TGSI.

Bind any compiled-stage/program reuse identity to the effective interpolation
interface. Switching a fragment stage between smooth and flat must not reuse an
incompatible vertex program. Preserve existing generation and context ownership.
The standalone flat fragment may be demonstrated against a literal flat VS,
but task completion also requires two translated TGSI stages linked through the
actual bridge/renderer pair path.

## Deterministic acceptance

`make verify-E6-T12e2` requires exactly 12 of the 19 unchanged original hashes
to translate; all seven PRECISE-bearing bodies stay rejected. Record native/Wasm
metadata and generated-source parity. Link and draw the original flat fragment
with a translated vertex stage and independent unequal per-vertex attributes;
assert literal interior pixels that smooth interpolation cannot produce.
Exercise smooth-to-flat-to-smooth relinking, including existing reuse identities.
Retain all prior shader/draw regression oracles and exact-head clean-clone proof.

## Adversarial verification

Attack missing or duplicate semantics, incompatible components/types/qualifiers,
malformed CONSTANT declarations, stage/context reuse and stale interface keys.
Sabotage the derived flat qualifier or reuse key and require the unequal-vertex
pixel oracle to fail. Translation alone is not compositor or Mesa bring-up.

## Verification log

### 2026-10-03 — worker — activation

E6-T12e1 is independently verified at
`d1fd813b786fd6ca5337b4d0f861aaa9aed97037`. This S/high slice adds only
fragment CONSTANT interpolation, a bounded internally derived two-stage API,
and owned vertex variants in the existing command renderer. It does not enable
production GPU negotiation. The accepted language and interpolation metadata
advance explicitly to `virgl-webgl2-straight-line-v4`.

Selected gates: C guard/native ASan+UBSan and fixed-memory Wasm build; exact
native/Wasm shader-pair parity and hostile pair inputs; real hardware smooth,
flat and mixed-interface pixels through both the pair API and actual command
renderer; program identity, allocation budget and cleanup attacks; prior shader,
state and draw acceptance; intended stale-program pixel sabotage; frozen-head
receipt and one scrubbed pristine clone. Unchanged Rust/device/default-web
boundaries carry forward. A fresh independent critic records the final verdict.

### 2026-10-03 — worker — recorded implementation claim

Frozen runtime/harness commit:
`8b7106488b84c256cae7f4eae87eee16a4f09eee`.

Commands:

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc \
VIRGL_PAIR_EVIDENCE_DIR=evidence/virgl-pairs/worker \
make verify-E6-T12e2
python3 tools/virgl-pairs/cold.py --output evidence/virgl-pairs/cold-clone
```

The v4 bridge admits the unchanged flat fragment
`67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa`,
bringing exact original acceptance to12/19; all seven PRECISE bodies still fail
with unsupported-feature. Both bounded original stage texts validate before
conversion. Checked fragment semantics derive the vertex qualifiers and canonical
interface key; no external shader key or rewritten source enters the compiler.
Native/Wasm results match exactly for all19 originals,114 pair fixtures and all
four hardware anchors. Seventy-five pair fixtures accept;39 reject. Fixtures
include eight semantic indices, three component masks, both interpolation modes,
all output/input coverage combinations, disjoint/unused varyings, exact input
limits, samplers, constants and malformed declarations. ASan/UBSan records38,259
compiler calls,932 truncations,320 direct hostile cases and4,096 mutations across
four fixed seeds, followed by21,848 pair and10,924 standalone exact recoveries.
The strict C guard and JS/Python syntax checks pass. Only the existing upstream
sprintf deprecation warnings remain.

Headed Chrome154.0.8037.93 / ANGLE Metal / Apple M4 Max executes8 direct pair
draws and44 actual command-renderer draws, checking520 independent pixels.
Unequal per-vertex attributes prove smooth, flat, mixed semantics, cyclic index
order and smooth→flat→smooth cache reuse. Mixed physical-register ordering
matches GENERIC semantic identity. Program keys include both immutable selector
generations and the effective interface. The original flat variant owns412
GLSL bytes; the mixed variant owns480. Twelve allocation/compiler/link/reflection
and malformed-pair controls restore prior publication and all counters; exact
quota and one-byte-too-small tests cover preallocation admission. Bound public
selector deletion, handle replacement, contexts/subcontexts and generation reuse
retain then collect the correct native objects. Every rig ends with zero renderer
budgets and zero native GL objects. Two isolated JS malloc-failure controls prove
first/second input ownership and same-instance recovery;19 hostile JS requests
return no partial stages and912 disjoint pair recovery conversions match exactly.

The stale-program sabotage compiles and links both programs, then deliberately
executes the cached smooth program for the first flat draw. At pixel(4,4), the
independent flat expectation[0,255,0,255] fails against[36,36,0,255]. The receipt
requires those separate real program identities and the intended pixel failure,
and independently recomputes every passing triangle pixel with integer rational
arithmetic. It also reconstructs the native input stream, binds all source and
served-file hashes to the frozen head, and checks native/Wasm outputs, budgets,
rollback and cleanup records. All61 completed worker receipt record hashes were
rechecked after the gate closed. Worker and cold screenshots were visually
inspected. Browser console/page/request arrays are empty.

The full gate retains9 literal shader draws/4,336pixels, original textured-scene
shader phases/768pixels,10 component draws/4,736pixels, existing hostile/captured/
component sanitizers, decoder/resource checks, hardware state/reflection tests,
and original210-packet/3-draw replay/768pixels with all existing sabotage controls.
Six contract tests continue rejecting capability, PRECISE, browser and execution
scope overclaims. Production GPU negotiation remains disabled.

The final pristine clone runs the same acceptance with compiler/build/runtime
overrides scrubbed, starts and finishes at the exact frozen head with empty Git
status, and retains the checkout plus copied evidence. No runtime repair or
worker/cold retry was needed. This isolated frontend/command-renderer change
preserves the unchanged Rust/device/default-web boundaries and live release from
T11c; it establishes neither Mesa/compositor bring-up nor FPS/MIPS improvement.

Evidence roots: `evidence/virgl-pairs/worker/` and
`evidence/virgl-pairs/cold-clone/`. SHA-256 anchors:

- `worker/receipt.json`: `d25f140bc69845e49660eb362b7f9edfd52f63e2f606241b76f2ea93b3de891a`.
- `worker/native/native-report.json`: `bbe1af294661bd03187d88b1f8f3f3a89a32af59357d249df8a50aadc118f5f0`.
- `worker/hardware/report.json`: `be4d41e3bb17a70ec4f7a4d1ac5eac011dca146b3c597f65fd7629be1bf1f32c`.
- `worker/hardware/browser.png`: `3aaf67714e680b879185f777c7f61b3d3ab3081ad26ee1587014de988fd56c91`.
- `worker/sabotage/report.json`: `3630468ff9f9b89ffcebde3bc70cb34de87e391e85c6da1dec4c1aa41f0682c8`.
- `worker/components/receipt.json`: `c1392f2d977180ffddb66153ec4e783ab8d2af37e773b6145a4f6d99e672ce46`.
- `worker/draw/receipt.json`: `cdb8a5805ce6597639fcd1ce92b34e39e34e76e49316b8a96e1bccdabcbf0535`.
- `cold-clone/report.json`: `334bea0d3044c94950be086c47d758986ff27c1e1063e5f68f32011fa889ebd3`.
- `cold-clone/acceptance/receipt.json`: `6bf2d0baa115bf3f312348cd2ed1f72a81bbc6222a5cb56c60314b8396ba4b9d`.
- `cold-clone/acceptance/hardware/report.json`: `5863c9d21d3f314c8d1bec848fcc73c2bc42ec4b196c5609a1371c4349848521`.
- `cold-clone/acceptance/hardware/browser.png`: `3aaf67714e680b879185f777c7f61b3d3ab3081ad26ee1587014de988fd56c91`.

Served shader Wasm:262,012bytes, SHA-256
`2c7a17530da765a9478f8f6edd1421f59375fe82789926375894bba58d1a1032`.
Retained pristine checkout: `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-pairs-cold-taha7w0z/wasm-vm`.
Cold log SHA-256: `7d04218daa7c008d145c75dbd32e6e3689bccab2d8c214ad5273560863a53f8e`; all67 copied acceptance file digests were rechecked.
