# E6-T12e2 independent predictions — before run evidence

This critic did not implement the pair compiler or renderer changes. The task and
current `cffb8d57..working-tree` source diff were read before opening any
worker/development recordings. No acceptance run has been inspected or executed.
The draft source snapshot is orientation only and must be rebound after freeze.
Writes are limited to this verifier directory; no status/commit before submission.

| ID | Falsifiable prediction | Independent observation planned |
|---|---|---|
| P01 | Exactly the prior11 plus unchanged flat original67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa translate, yielding12/19. The seven PRECISE originals remain rejected by exact hash; no original text is patched. | Hash all raw bodies, compare prior/frozen Git blobs and native/Wasm outcomes; retain explicit failure reasons. |
| P02 | CONSTANT is accepted only on the existing fragment GENERIC declaration grammar. Missing/duplicate/unknown interpolation words, extra qualifiers, malformed separators, CONSTANT on VS outputs or attributes, and other semantic/type forms reject. | Independent literal stage/declaration mutations followed by valid recovery; old PERSPECTIVE forms still work. |
| P03 | Standalone fragment metadata exposes flat for CONSTANT and smooth for PERSPECTIVE. Standalone VS GENERIC outputs stay smooth. Only matched pair VS GENERIC outputs receive FS modes; unmatched outputs stay smooth. POSITION/COLOR/attributes never acquire an interpolation field. | Exact native/Wasm metadata, original-stage identity and generated-source/actual GL reflection/link. |
| P04 | Pair matching uses GENERIC semantic identity, not physical register slot or declaration order. A shuffled OUT7↔IN0 mapping with GENERIC3 matches; same register with a different semantic does not. | Enumerated physical-register/semantic permutations, an independent semantic map and actual mixed-interface draws. |
| P05 | Each FS declared component set must be covered by a fully written matching VS output. xyz→xy accepts; xy→xyz and absent semantics reject. Duplicate declared semantics remain invalid within each stage. Both texts are validated before any upstream compile. | Cross product of component masks3/7/15, absent/duplicate semantics, incomplete outputs, and a pair with both a valid interface and invalid later instruction. |
| P06 | Canonical interface key is semantic-sorted and contains each declared FS component mask and interpolation mode exactly once. Equivalent physical-register/declaration permutations produce the same key. Changing mask/mode/semantic changes the key; no inputs gives only the prefix. | Literal independently constructed keys, native/Wasm equality and renderer program-key snapshots. |
| P07 | Pair derives only the checked fragment interpolation export; caller compiler keys cannot enter through extra string/symbol/non-enumerable keys, prototype fields or accessors. Getter bodies are not invoked. Failed reflective proxies return structured errors. | Actual browser translatePair hostile request objects with side-effect counters, revoked Proxy and reentrant reflection controls; valid recovery after every rejection. |
| P08 | Each pair text retains 16KiB/128-instruction/8192-token/per-register limits. Two maximal legal inputs fit fixed Wasm memory/stack; one oversized or non-ASCII/NUL input rejects without affecting a later pair. Length arithmetic cannot wrap. | Independent per-side at/over bounds, native explicit lengths/null inputs, sanitizer traces, actual fixed-memory Wasm stress. |
| P09 | Native errors never return a partial stage; successful pair output independently owns complete vertex/fragment source+metadata in the response. Alternating single/pair/failure calls preserves exact output and resets response capacity correctly. | Parse every JSON result, copy and compare earlier success, alternate longest/error/short calls; native static result borrowing documented, JS result owns data. |
| P10 | Fragment is compiled before the vertex and its bounded value-only interface is checked against declarations. No upstream-owned interpolation/output pointer is persisted or aliased into later pairs. All outputs/arrays are freed on every failure phase. | Source-bound C coverage and native ASan/UBSan stress; exercise failed fragment and vertex conversions or classify truly unreachable trusted-upstream defenses narrowly. |
| P11 | The unchanged flat fragment links with an actual translated TGSI vertex stage through translatePair. With unequal RGB vertex values, every interior flat pixel equals the last/provoking vertex value; the smooth counterpart produces the independently chosen different literals. | Actual hardware translated pair draw and literal color oracle below; standalone flat helper is insufficient. |
| P12 | The actual command renderer uses the pair compiler for flat consumers, validates pair source/metadata/key and creates an owned vertex variant. Smooth consumers retain the existing single-stage path. | Literal command submissions through real resources/state owners; count actual compile/link calls and inspect selected program identity. |
| P13 | Smooth→flat→smooth yields correct unequal-vertex pixels on every step. At fixed selector generations, returning to a previously validated interface reuses its exact program; an incompatible smooth vertex/program cannot serve flat output. | Actual GL program identity/object counters, renderer key snapshots and pixel checks before/after switching. |
| P14 | Every successful reuse key includes both selector generations and the effective interpolation key within its subcontext. Reusing numerical shader handles after deletion, switching contexts/subcontexts, or changing selected vertex generation cannot find another owner's stale program. | Actual command lifecycle with equal handles across contexts, delete/recreate same handles, alternating subcontexts and context generation recreation. |
| P15 | Source/metadata returned by a flat pair must match the selected original fragment and the expected VS metadata. Missing pair capability, wrong key/type/mask/qualifier, swapped stage, malformed/oversized GLSL and changed fragment bytes fail without installing a program. | Trusted faulty compiler wrappers only for diagnostic boundary tests, live GL counters and later valid recovery. Do not represent such wrappers as guest-controlled metadata. |
| P16 | Vertex variants count against shaderBytes and program limits. Allocation, compilation, link, reflection and budget failures unwind variant shader/program/UBO objects and counters exactly once; no failed program/cache key is published. | Tight quotas and bounded trusted allocation/reflection fault controls around actual native GL, with snapshots before/after and recovery at a sufficient budget. |
| P17 | Destroying a public shader still respects bound selector ownership; releasing the last reference, destroying a subcontext/context, reset and disposal delete associated variants/programs/blocks once and return owned counters to zero. | Actual GL identity/lifetime oracle, both owner disposal orders and bound/unbound shader destroy cases; prior unchanged ownership findings carried only by exact source boundary. |
| P18 | Checked metadata is immutable so the memoized fragment interface cannot become stale. Untrusted caller changes to earlier returned plain JS pair results cannot mutate retained renderer translations. | Modify external returned source/metadata and then relink/draw; inspect captured private ownership via public snapshots, no assumed mutable cache keys. |
| P19 | Smooth+flat mixed semantics retain distinct qualifiers, including unused declared inputs and declaration-order permutations. Texture and constant binding metadata remain correct through the pair route. | Actual native/Wasm mixed interface and GL pair programs using literal textures/raw float-bit constants, plus all new positive anchors frozen by the worker. |
| P20 | Removing derived qualifiers or deliberately reusing the smooth program during the flat step makes the unequal-vertex oracle fail at a concrete pixel/selected-program assertion. | One isolated source or host-call sabotage with exact original/mutated bindings and intended failure; no shared runtime edit. |
| P21 | Prior shader/component, command-state and draw oracles execute on final source; the new output formatter preserves ordinary single-stage behavior and error handling. Rust/device/default-web bytes and production negotiation remain unchanged. | Bound final regression records and source hashes; no replay of unrelated native/device/performance suites. |
| P22 | Final exact-head receipt and one scrubbed clean clone reproduce the full scoped gate. Every changed executable C and JS branch is exercised or explicitly classified; tests/fixtures, served Wasm and native compiler are hash-bound. | Independent receipt interrogation, source-bound C/V8 counters, actual native GL and screenshots; no implementation agent used as verifier. |

## Literal pixel oracle selected before evidence

Use a 16×16 RGBA8 framebuffer with blending/dither/depth/cull disabled and a
single triangle whose window-space vertices are `(0.5,0.5)`, `(12.5,0.5)`,
`(0.5,12.5)` (clip XY respectively `(-0.9375,-0.9375)`,
`(0.5625,-0.9375)`, `(-0.9375,0.5625)`, all w=1). Per-vertex GENERIC0 RGBA
is red `(1,0,0,1)`, green `(0,1,0,1)`, blue `(0,0,1,1)`.
The unchanged CONSTANT fragment must produce `[0,0,255,255]` at all three
interior probes `(3,3)`, `(6,3)`, `(3,6)` read in bottom-up GL coordinates.
The PERSPECTIVE counterpart's independently known barycentrics are respectively
`(.5,.25,.25)`, `(.25,.5,.25)`, `(.25,.25,.5)`, producing normalized RGBA8
literals `[128,64,64,255]`, `[64,128,64,255]`, `[64,64,128,255]`.
The vertex stage must itself be translated TGSI, with system Y adjustment1.
No expected pixel is computed from bridge output or a worker screenshot.

A mixed pair can declare GENERIC0 flat/full and GENERIC3 smooth/xy. Its canonical
key must be exactly `generic-interpolation-v1:g0/15/flat;g3/3/smooth`, regardless
of the physical register order. Use unequal per-vertex GENERIC3 values to make a
mistaken all-flat interface observable, not merely inspect GLSL strings.

## Bounded novel attack plan

Enumerate a bounded permutation grid over physical output/input indices
`[0,1,7]` (respecting reserved POSITION output0), semantic IDs `[0,3,7]`,
component masks `[3,7,15]`, interpolation modes smooth/flat and declaration order.
Compare admission and canonical keys to an independently written semantic-set
oracle, then exercise representative equivalent keys and conflicting interfaces
on hardware through the actual renderer. Alternate known-good single/pair calls
and malformed pair inputs with two independent seeds `0x00e612e2` and
`0x47c033a9`; bound any stress count before execution. Include repeated same
vertex with flat/smooth/mixed consumers and numerical handle reuse after release.

## Coverage focus and draft observations

New C behavior includes flat grammar, staged response capacity, shared check/
convert/cleanup helpers, stage formatter, checked upstream interface, semantic
matching/key sorting and failure cleanup. New JS behavior includes reflection
without getters, two-allocation unwind, metadata/interface normalization,
variant quota/creation/compile/link/unwind/delete and cache publication/reuse.
Source shapes and field declarations are not executable counters. A private
trusted-upstream diagnostic guard is not an excuse to omit a reachable supported
input path. Held E1 semantics require final same-source regression because the
C single-stage implementation was refactored here.

Draft inspection finds no established runtime blocker. The pinned upstream
`vrend_fs_shader_info` contains a fixed value array of interpolation records;
its vertex qualifier lookup matches semantic identity. Renderer selectors retain
frozen translation metadata and generation-bound program keys; the freshness
and ownership predictions above still require execution evidence.
