# E6-T12g6k independent verifier seal

VERDICT: verified. All 13 predictions were written before worker-state inspection
and held. Frozen runtime `c947442bad912ebcd46d3ff30a0e4c71be87ca4a`; permanent guard/wiring and final
local acceptance head `0eb794639b408c80aa6f35688bf85e15a433a845`. The verifier did not edit implementation.

Authenticate `manifest.json` against `records.json`, then authenticate every
regular archive member by the index size and SHA256. The archive contains 532
actual files: `critic/` holds predictions, verdict, independent literal-source /
clip-geometry transcripts, original-profile re-exports, replay logs, fresh physical
captures and three real sabotage inputs/results; `acceptance/` is the complete
promoted acceptance run; `original/` preserves both original actual hot/cold
sanitizer binaries and profiles; `generated/` and `sources/` preserve the corresponding
compiled artifacts, literal primary witnesses and proving sources. The independently
authenticated 127-member worker seal remains at `../worker/`; points prefixed
`worker-recording/` in the verdict refer to that archive.

Archive SHA256 `a05686aa76631217e32eb2b598b48fc0305a0ab43e5b692d0934aad82323edc2`.
Record-index SHA256 `50372d59bfdca970e0ff520572c18bf0f4f0916222ed0190f2c2bff01b6672d4`.
Verdict SHA256 `a5f446813901b5e54b09e4330c604450d7cac3b1ce3461b893f77d71d6393c77`.
Predictions SHA256 `31d879d5b2e5dec5c331378378e7aac1cedc67be74762b3371a80e44595aa181`.

`make verify-E6-T12g6k` passed with the promoted independent checks: 380 complete
native/Wasm singles and pairs, 32 inert metadata and 480 owned-bank attacks,
plus the existing task acceptance. The independent forward evaluator imported
no worker oracle, compiler IR, emitted-source calculation or cached expected words.
Four distinct physical schedules checked 657,696 complete component words; the
largest observed variable-derived error was 2^-21 within the measured 2^-20 budget.
Fresh seed 3737844652 used two commands per step and checked 162,568 words with
48 atomic rejections on headed Chrome/WebGL2 Metal/Apple M4 Max. Source admission,
promoted-test expectation and jointly forged pixel/cache sabotages each failed
at the intended point. Original emitted X/Y/Z/W faults also failed independent
predictions. Coverage accounts for 118 executed lines and nine individually reasoned
nonexecuting waivers, with no executable proof gap.

Ten unchanged predecessor HELD predictions and the authenticated pristine scrubbed
c947442b cold run carry forward. The promotion changed only tests/wiring, so no
second clone was needed. Accuracy is measured for this physical configuration.
Original full compositor bodies and production negotiation remain gated; no live
guest integration, demo/public capability, FPS or MIPS claim follows.

Primary semantics were independently derived from the literal original c5806d5f
TGSI header and pinned Mesa tokens/vrend handling, with
[Mesa TGSI documentation](https://docs.mesa3d.org/gallium/tgsi.html) and
[ESSL 3.00 §7.2](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).
Concrete file/line and token points are recorded in `critic/source-semantics.json`.
