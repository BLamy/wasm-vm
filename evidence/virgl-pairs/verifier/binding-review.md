# E6-T12e2 independent binding audit

Read the task and source diff `cffb8d57..8b710648` before examining evidence.
Frozen source is `8b7106488b84c256cae7f4eae87eee16a4f09eee`; worker claim is
`09e923695edd77d2b0500e3e81ce7cabfcc60835`. This is a new E2 audit, not a
carry-forward of the prior E1 verdict. No builds or implementation/status edits.

Result: **bindings held; no concrete provenance or oracle blocker found**.
Main verifier owns the implementation coverage, novel attacks, and task verdict.

Repeatable command:

```sh
python3 evidence/virgl-pairs/verifier/binding-audit.py
```

This independent script imports no product translator or worker verifier. It
reads Git/files and writes only its own `binding-audit.json`. The run completed
26,611 assertions, including individual digest/parity/pixel checks. That count
is not a claim of changed-line execution coverage.

## Evidence bindings

- Worker receipt matches
  `d25f140bc69845e49660eb362b7f9edfd52f63e2f606241b76f2ea93b3de891a`.
- Cold report matches
  `334bea0d3044c94950be086c47d758986ff27c1e1063e5f68f32011fa889ebd3`.
- Cold receipt matches
  `6bf2d0baa115bf3f312348cd2ed1f72a81bbc6222a5cb56c60314b8396ba4b9d`.
- Each receipt's 156 tracked source bindings match actual files and frozen
  Git blobs. All 61 evidence record bindings per receipt match, as do all
  67 copied cold files, compiler files, native sanitizer binary, and native log.
- Every recorded source and file-backed served body in the nested reports
  matches actual worker/retained-clone files and the frozen commit wherever
  tracked. Dynamic prior-draw HTML is independently reconstructed from its
  frozen wrapper literal. Dynamic fixture transport digests match the recorded
  original/sabotaged transport bindings; those fixture generators and input
  evidence are themselves frozen/bound, not replaced with hand-written fixtures.
- Both runs served the same actual 262,012-byte shader Wasm:
  `2c7a17530da765a9478f8f6edd1421f59375fe82789926375894bba58d1a1032`.
  Pair, state, decoder, resource, wrapper, and harness source bytes are bound.
- The 20 nested reports per run name the E2 frozen head with no tracked source
  changes and empty browser-error arrays. Prior shader/state/draw results are
  fresh runs at this head, not merely prior-task receipts.

## Native/Wasm and original inputs

Every one of the 19 original bodies is byte-identical to the baseline and
frozen Git blobs and its content-address hash. Accepted identities equal the
previous eleven plus original flat fragment `67c701fa...`; all seven remaining
bodies contain PRECISE and fail with unsupported-feature. No original is
rewritten. Standalone native log/report/browser results agree exactly.

All 114 pair cases, including generated GLSL and metadata, agree exactly between
native logs, native report, hardware Wasm report, and sabotage Wasm report.
Fixture outcomes are 75 acceptances/39 rejections. The audit reconstructs the
entire VGP1 native input stream from actual original bytes and frozen fixture
texts and matches its digest. Four hardware anchors match native pair results
for those exact texts; the flat anchor's fragment is the unchanged original.
Recorded repeated conversions equal 912, with disjoint pair identities.

## Independent pixel oracle and actual renderer

The fixed triangle uses positions (-1,-1), (1,-1), (-1,1), w=1, and unequal
vertex RG values (0,0), (1,0), (0,1). Its interior pixel-center barycentric
weights are `1-(x+.5)/32-(y+.5)/32`, `(x+.5)/32`, `(y+.5)/32`. The independent
audit computes exact rational channel values and rounds to UNORM8. Flat output
uses the third submitted vertex; cyclic order therefore changes its literal
color. Mixed output takes GENERIC0's flat red and GENERIC1's smooth green,
despite reversed physical declaration order. Three exterior samples must remain
clear blue. These expectations use no generated GLSL, metadata or GPU readback.

Browser literals are at `renderer/virgl-shader/tests/pairs.mjs:42-47` and receipt
integer arithmetic at `tools/virgl-pairs/receipt.py:316-338`. Both derive from the
fixed inputs, rather than treating converter output as its own expected answer.
The audit independently reconstructs all 10 checks in each of the 8 direct pair
draws and 44 renderer draws: all 520 pixels per run match.

Direct stage-source digests equal the corresponding native/Wasm anchor sources.
For every one of the 44 renderer draws, the audit finds exactly one matching
recorded native `drawElements` event with three indices and the current program
ID, plus an earlier successful native link event for that ID. The instrumentation
observes real GL calls (`renderer/virgl-command/tests/flat-pairs.mjs:30-44`).
Passing draws execute the requested program. Program keys include both immutable
selector generations plus the effective interpolation interface. The initial
smooth/flat programs are distinct and later draws reuse the appropriate IDs.
Renderer pair requests match exact native results, and all rigs end with zero
budgets and no live instrumented GL objects.

The sabotage deliberately executes the separate smooth program for flat output:
pixel (4,4) expects [0,255,0,255], observes [36,36,0,255], and requested/executed
program IDs differ. It tests the oracle's sensitivity to stale smooth reuse,
rather than merely failing shader compilation.

## Regression and cold-clone checks

All same-head prior shader pixel reports remain passing and source-bound:
nine literal draws/4,336 pixels, three captured shader phases/768 pixels, and
ten component draws/4,736 pixels. State/decoder/resource reports pass. The
original replay records 210 packets and three GPU draws; the audit constructs
the three complete 32x32 RGBA quadrant images independently and matches all
three recorded staging-readback hashes, lengths, and offsets 64/4160/8256.

The retained cold clone independently still reports the frozen head and empty
`git status --porcelain --untracked-files=all`. Recorded start/end heads/status
agree. The cold harness and log match their recorded hashes. The frozen harness
scrubs compiler, build, browser, Node, Python, shell, Rust/Cargo, and task/runtime
overrides before cloning/building/running (`tools/virgl-pairs/cold.py:39-46`).
The run records removing inherited GIT_PAGER and RUST_LOG. This is evidence of
the bound scrub implementation/run; no complete environment snapshot was
recorded. Compiler cache is an explicit pinned prerequisite, and the shader
artifacts themselves are built inside the clean clone.
