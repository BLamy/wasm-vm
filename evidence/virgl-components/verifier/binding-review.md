# E6-T12e1 independent binding and oracle audit

Scope: read the task and changed sources against `ebd18189` before examining
the worker/cold recordings. No implementation, build, status, or task edits.
Frozen source: `ae3bdf0f1d707f239b00907269f5c783fcf597e5`; worker claim commit:
`2b17963668dcd06f3378366478e6164b2ec2d6d4`. This is a binding sub-audit, not the
overall task verdict or a replacement for the main verifier's code coverage.

Repeatable command:

```sh
python3 evidence/virgl-components/verifier/binding-audit.py
```

The script imports no worker verifier/translator code. It only reads files,
queries Git, and writes its own `binding-audit.json`. Result: `bindings-held`.

## Held bindings

- Worker receipt SHA-256:
  `2c9115baa9649dbf7b8f4dfe01227c99e61e66538e19d00ded00eb1ef8a5743a`.
- Cold receipt SHA-256:
  `32d2d19d454a92d977bb52193faaa7e1291a1875559a56991d416273e10be7c5`.
- Each receipt's 111 tracked source bindings match the frozen commit and
  actual files; all 18 bound evidence records match. Browser source/served
  bindings match actual worker/retained-clone files and Git wherever tracked.
  All 26 served bodies match, including the 258,527-byte Wasm artifact
  `f2d4c721eaccebe8d967f8ba3d87b62228e2b7add4066971d7ab5560c8ec45eb`.
- Compiler digests, native sanitizer executable digests, native logs, cold
  harness, cold log, and every copied cold acceptance-file digest match.
- All 19 raw bodies are byte-identical to both baseline and frozen Git blobs;
  accepted identities are exactly the old seven plus the requested four.
  Every remaining unsupported body retains PRECISE; the flat/CONSTANT body
  retains its parse rejection. Outcomes are 11 translated, seven unsupported,
  one parse error. All 19 native contract results equal browser results.
- Four new native original results equal the same corpus results; all 249
  shared cases match native/Wasm outputs and fixture bytes. Recorded recovery
  is 1,992 conversions. These counts do not establish changed-line coverage.
- Prior literal nine draws/4,336 pixels and captured three phases/768 pixels
  have their original bound reports, matching readback expectations, frozen
  sources, and empty browser error arrays. Component browser errors are empty.
- The retained cold clone independently remains at the exact frozen head with
  empty `git status --porcelain --untracked-files=all`, matching its recorded
  before/after state. The bound cold harness removes CARGO/RUST/VIRGL/npm/GIT/
  EMCC prefixes and explicit compiler, linker, Node, Python, browser, Make, and
  shell override variables before clone/build/run (cold.py:39-46). Reported
  inherited removals are GIT_PAGER and RUST_LOG. This verifies the actual bound
  scrubbing implementation and reported run, not an independently captured
  complete environment snapshot. The pinned cached compiler is a prerequisite,
  not an inherited prebuilt shader artifact.

## Oracle provenance held

The browser uses literal texels, brightness, and geometric coordinates, never
translator output or GPU readback to construct expected colors. Receipt
`Fraction` arithmetic is likewise independent of generated GLSL and observed
pixels (`tools/virgl-components/receipt.py:147-185`). Its geometric expression
is algebraically the browser expression, not a separate semantic oracle; the
independent check here derives it from the raw captured shader operations.

The fragment bodies select yz texture coordinates, put brightness in TEMP0.x,
put the float-one bit pattern in TEMP0.y, then multiply RGB by brightness and
alpha by one. Literal expected RGB at brightness 0, 1/2, 1 and distinct alpha
bytes follow directly. Neither test computes expected colors via the bridge.

For the affine original, the specified inputs/constants produce clip position
`(.5x-.125y+.25, .125x+.5y-.25, .125x+.25y-.5, 1)`. The matrix original produces
exactly twice this clip vector with w=2. Thus identical projected geometry for
the two originals is deliberate, not mistaken source reuse. The audit solves
the 2x2 matrix via its determinant, checks actual recorded uniforms/attributes,
and reconstructs every expected coordinate/color independently: all 4,736
pixels per run match. Compiled stage GLSL digests equal the native/Wasm result
for each original. The literal helper shaders are visible, frozen inputs.

The existing sabotage is bound to the exact generated-source rewrite and fails
at pixel (15,4): expected foreground [255,64,128,255], observed background
[0,0,255,255]. It establishes sensitivity to setting the dropped z lane to zero.

## Coverage limitation sent to the main verifier

The task explicitly requires a wrong source swizzle not to pass (task:49).
Vertex depth is observed only through LESS against clear depth 0.5
(`renderer/virgl-shader/tests/components.mjs:182`, `:219-230`, `:283-292`);
the receipt reconstructs only projected geometry and foreground/background.

A specific z-only wrong source selector can evade this oracle. Correct affine
z is `.125*x + .25*y - .5`; using x in place of y for the TEMP1 z product gives
`.375*x - .5`. Over the whole input quadrilateral, both have extrema -7/8 and
-1/8. They therefore remain in clip bounds and below zero; all existing depth
decisions and x/y coverage remain identical. The audit records this rational
counterexample, but does not claim a GPU execution of it. The main verifier was
promptly asked to resolve it with its independent GPU attack or an exact-z
semantic assertion. No binding/provenance refutation was found; this sufficiency
question belongs to the task verdict.
