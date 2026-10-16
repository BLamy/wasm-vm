VERDICT: verified

Independent verifier of worker source 6cf7981877fc4dab83cd902cd69d56a8795f051b,
submitted by 2cd2572ec014cf19c41c2a8a32b30739a7e3c6c9. Read task and diff from
0abd0745 before evidence. Predictions were written first in predictions.md.
The medium-risk boundary is a contract and isolated prototype, with no guest
GPU, desktop compatibility, portability or deployment claim.

- P1 provenance — HELD. Worker receipt and browser digests equal the task's
  declared 50b671b0…d4daf and 555ddecb…715b1. Both identify frozen head 6cf79818.
  Independently checked all 10 receipt sources, 89 browser source records, 12
  served records, screenshot and four capture manifests against actual bytes.
  audit.json records the full digests; fresh receipt source hashes are identical.
- P2 completeness — HELD. Fresh acceptance reconstructed the raw captures and
  matched 33 command, 8 object, 37 instruction, 17 API, 2 stage and 9 resource
  format families, plus vertex29=10 and vertex30=6. All 19 literal captured
  bodies reject: 15 unsupported-feature, 4 parse-error (acceptance/receipt.json
  lines 144–188). Pins are riscv64, Mesa 1:26.2.2-1, Hyprland 0.56.2-3 and
  VirGL 1.3.0/ca50e008863837e094747a69974dde3ae148aeaa. Current production
  advertisement stays empty; unchanged gpu/mod.rs:292,662,678–679 agrees.
- P3 translated literal draws — HELD. Fresh headed Chrome 154.0.8037.93 on
  hardware ANGLE Metal Apple M4 Max completed 9 draws and 4336 pixels, with no
  console/page/request errors. Independently compared report oracles and reviewed
  the screenshot. The original browser test loops every pixel, not merely its
  reported sample (renderer/virgl-shader/tests/browser.mjs:210–224).
  acceptance/browser/report.json:2316 records the total; 2243 records hardware.
  This remains literal TGSI proof, not execution of the 19 captured bodies.
- P4 difficult mappings — HELD. Checked recorded RGBA values independently:
  BGRA preserves alpha109/7, BGRX and RGBX force255 (report lines 2831–2935).
  All 128 A/B/A state-replay pixels match red-left/blue-right and transparent
  opposite halves (2940–3535). Baseline ESSL compiles; precise fails with compiler
  diagnostic (2815–2828). PRECISE and Z32_UNORM remain rejected. No general
  texture reinterpretation or full context isolation is inferred.
- P5 limits/ABI/fences — HELD. Browser limits meet the explicit future
  prerequisites (report:2322), but are not advertised caps. C oracle matched
  every field/mask and v1=308/v2=1408 with layout digest ee3daa5d…1e76f.
  Fence first poll TIMEOUT_EXPIRED, timer runs before signal and all four pixels
  are green (report:3539–3602). Negative tests reject altered browser tuple,
  software renderer, insufficient UBOs, false support and stale evidence.
- P6 bounded novel state attack — HELD. The promoted test poisons program, VAO,
  framebuffer, viewport, texture unit, sampler binding, enabled raster state,
  color mask and scissor after each draw. Seven independently recorded poison
  events report no GL error; original pixel and identity assertions still pass.
  state-poison.json:1419 records the events. Its hash is
  854a91e0a13ca83ce29777f5c6e0f7d155c1b6b27ee1567dc32c41646268c4f3.

Coverage and fixture audit:

- docs/gpu-3d-decision.md and gpu-3d-contract.json: declarative configuration;
  direct semantic audit plus raw-corpus key/count reconstruction. Future mapping
  descriptions do not purport to be executed renderer implementations. All current
  support claims are scoped to the bounded literal bridge; every captured body is
  rejected and activation blockers are explicit. No mock guest run is substituted.
- renderer/virgl-contract/browser.mjs: precise V8 coverage in probe-coverage.json
  records positive hits for all 23 entries (including callbacks). All view cases,
  both context states and both sides of the fence-progress loop ran. Untriggered
  assert failure arms are diagnostics, not unproven supported behavior.
- tools/virgl-contract/caps_layout.c and capset-layout.json: Clang instrumented
  run in abi-coverage.json covers 6/6 functions, 124/127 lines, all emitted fields
  and masks. The unsupported-big-endian diagnostic at lines247–249 and error
  result on broken stdout are waived: neither claims portability or a capability.
- tools/virgl-contract/verify.py and test_verify.py: python-coverage.json records
  184 and 40 hit lines. All verify.py statements except final exception logging
  and exit214–215 ran; the four tests exercised the negative guards. Test imports
  and definitions ran during discovery outside the tracing window; its standalone
  unittest.main alias is waived because discovery ran all four tests.
- tools/verify-virgl-contract-browser.mjs: headed acceptance exercised launch,
  source hashing, actual CDP hardware checks, module/Wasm/text serving, page
  evaluation, pixel results, screenshot, report and cleanup. Failure-only timeout,
  404/error capture, and report-on-failure branches are waived as diagnostic
  scaffolding for this isolated local proof, with no deployment/server claim.
- tools/verify-virgl-contract.sh and Makefile: exact acceptance command executed.
  Optional toolchain/bootstrap paths are unchanged helper invocations; waived as
  environment setup because this task has no installation or cold-clone claim.
- Task/queue/evidence: bookkeeping and recorded outputs, checked directly. No
  implementation code was edited during verification. No ignored test, disabled
  assertion or panic-suppressing change exists in the task diff.

The pixel fixtures are literal byte oracles independent of generated GLSL.
PRECISE compilation is explicitly a negative language test. Format probes establish
allocation/completeness only. The host-only browser matrix is default-deny, and no
performance budget or full GPU implementation is implied.

SUITE: promote tools/virgl-contract/test-state-replay.mjs as a reproducible headed
hardware-browser regression; retain source-bound coverage and attack output.
No runtime fix, broad workspace gate, live deployment or cold clone was needed.

Commands:

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_CONTRACT_EVIDENCE_DIR=evidence/virgl-contract/verifier/acceptance make verify-E6-T10c
node --check tools/virgl-contract/test-state-replay.mjs
VIRGL_CONTRACT_ATTACK_DIR=evidence/virgl-contract/verifier node tools/virgl-contract/test-state-replay.mjs
```

Additional bounded instrumentation reran verify.py plus its four unit tests under
Python trace and caps_layout.c under Clang coverage; their source-hashed results
are python-coverage.json and abi-coverage.json.

Independent upstream source audit:

- VirGL sources compared to explicit Git object ca50e008863837e094747a69974dde3ae148aeaa
  with `git -C /tmp/wasm-vm-virglrenderer-research show <revision>:<path>`; current
  research-checkout HEAD was deliberately not used.
- src/virgl_hw.h SHA256 191ca5cea527949a29e9753b1e31d550f2fed922895d78dabc5c5c3585aa2ff7.
- src/vrend/vrend_shader.c SHA256 e08fe8ceebfebb3e6a050b74d0ea0ebbfab35b6be742b6f0c9b9149dd484c3e2.
- src/vrend/vrend_renderer.c SHA256 be7e5c63fb501cb77bd5b2c13c332f8b93c49fd04d207f17d434932c237f4ea3.
- Mesa source files freshly fetched from the official GitLab raw mesa-26.2.2
  tag matched local inspection copies: virgl_screen.c SHA256
  6a78bf41561a59e440d814a31a392ee07a03cf54a367ca49cfe71086aa7e85a8;
  st_extensions.c dbed39e3997c3fbc5e3a02c0fd6845cb43ab67f2c7972362ce20c225a24138ff;
  version.c 8d3fd4701b3ec44276fcc0bbd3cafecfcb026043c01b74d9ddf018d3a116a24b.
- UBO accounting: Mesa virgl_screen.c:214–215 and st_extensions.c:265–269,324–328;
  VirGL vrend_renderer.c:1724–1815,12212–12215. These support 13 host blocks per
  stage, 26 uses and 25 binding points for the stated future 12-guest-block tier.
- Capset versions/layout: vrend_renderer.c:90–91,12863–12886,13133–13148. Strict
  PRECISE omission without gpu_shader5: vendored vrend_shader.c:4384–4389,
  4482–4487,6640–6646. The contract rejects rather than silently weakens it.
