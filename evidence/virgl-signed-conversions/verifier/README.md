VERDICT: verified

This fresh critic read the task and scoped diff before recording predictions. All eleven predictions held. The runtime freeze is `c4b811d7686e4fa59706324fcec6c3eecdc559d0`, source/harness freeze `2e67fac91552702add11c701f61d6c4c0af2260c`, and submission `4c001e35`, above independently verified `7f2cdec89ca53b37bac120538bb168aaa153d62f`. `verdict.json` and `verdict.md` cite exact report points and digests.

The worker dependency is `../worker/recording.tar.gz`, SHA256 `0302fd33c25937206456e6549502f89122fdb73f622c920c573be8bc4da6b336`. This critic authenticated all 81 members and both frozen source sets. The critic archive does not duplicate that recording; extract the worker archive into `unpacked/` to reopen its point paths. The actual cold sanitizer binary was read from its retained pristine clone and authenticated against the cold receipt. Its bytes are preserved as `cold-recorded-sanitize`. The hot recording legitimately carries forward because the only repair changed `consumer.mjs` and `receipt.py`; cold evidence is pristine, scrubbed and exact to the final source head. No second cold clone was run.

`audit.py` predicts words and pixels from original TGSI, actual constant uploads/input attributes, masks/swizzles and structured control flow. Its equations use Python binary32 pack/unpack, signed integer decoding and truncation. It does not read emitted GLSL or worker equations to predict results. It independently checked 228,816 words and 75,136 pixels in the six authenticated hot/cold recordings, plus 37,800 words and 12,480 pixels in a fresh fourth hardware seed. Independently recompiled frozen native source matches 728 public native/Wasm/pair cases and 1,136 unique GPU source records.

Commands actually run, with results in this directory:

```sh
python3 evidence/virgl-signed-conversions/verifier/audit.py
node tools/virgl-signed-conversions/browser.mjs --output evidence/virgl-signed-conversions/verifier/gpu-324508639 --seed 324508639
python3 evidence/virgl-signed-conversions/verifier/audit.py --gpu evidence/virgl-signed-conversions/verifier/gpu-324508639/report.json --output evidence/virgl-signed-conversions/verifier/fourth-seed-semantics.json
# Build run from the isolated frozen-source scratch/current directory:
bash renderer/virgl-shader/build.sh native
node renderer/virgl-shader/tests/signed-conversion-regressions.mjs --native evidence/virgl-signed-conversions/verifier/scratch/current/renderer/virgl-shader/build/native/virgl-shader --root evidence/virgl-signed-conversions/verifier/scratch/current --output evidence/virgl-signed-conversions/verifier/independent-regressions.json
NODE_V8_COVERAGE=evidence/virgl-signed-conversions/verifier/node-consumer-coverage node tools/virgl-signed-conversions/consumer.mjs evidence/virgl-signed-conversions/verifier/unpacked/hot/native/report.json evidence/virgl-signed-conversions/verifier/repeated-consumer.json
NODE_V8_COVERAGE=evidence/virgl-signed-conversions/verifier/node-attack-coverage node evidence/virgl-signed-conversions/verifier/consumer-attacks.mjs
node evidence/virgl-signed-conversions/verifier/boundary-attacks.mjs
python3 evidence/virgl-signed-conversions/verifier/coverage-audit.py
# Expected failure against the actual source range-proof mutation:
node renderer/virgl-shader/tests/signed-conversion-regressions.mjs --native evidence/virgl-signed-conversions/verifier/scratch/range-fault/renderer/virgl-shader/build/native/virgl-shader --native-only --output evidence/virgl-signed-conversions/verifier/sabotage-regressions.json
```

`scratch-source-binding.json` binds the isolated compiler sources to frozen Git. The seal includes the actual resulting binaries as `native/virgl-shader-current` and `native/virgl-shader-range-fault`, plus the promoted guard source as `promoted/signed-conversion-regressions.mjs`. The full original and changed range-proof source is in `sabotage-source.json`. After extraction, make binary members executable before running them. Wasm artifacts are the authenticated `generated/wasm` members of the worker dependency; place them under `renderer/virgl-shader/build/wasm` in an isolated frozen-source checkout for the guard's `--root` option. Native-only reopening needs just `--native` and `--native-only`.

The guard report uses schema `virgl-signed-conversion-critic-guards-v1` and contains all 1,575 native and Wasm cases, full source/result arrays, independent feasible word sets and hashes. One real source mutation changes the strict positive upper bound to inclusive. The promoted suite fails at `range-cube-1325400064-0-identity-x`: source word `0x4f000000` is independently forbidden but the faulty compiler admits it. This is a real compiler/source/range test.

The final coverage audit accounts for every one of the 55 scoped hunks and 236 added runtime lines. Authenticated LLVM exports reproduce helper coverage of 29/29 lines, 28/28 branches and 61/61 regions; V8 captures cover the actual browser and Node consumers. The direct malformed-bank and unexpected-exception paths were exercised. No runtime hunk is dead or needs evidence. All prior unchanged G6a/b/c/d HELD records carry forward.

The fourth-seed screenshot was inspected. `cleanup.json` checks its Chrome user-data-dir against live processes, and physical objects/resource budgets return to zero. No implementation or worker output was modified. Mesa TEMP comparisons retain their documented normal/zero restriction; owned checks cover all defined word classes. Production/captured compositor imports/caps, guest boots and MIPS/FPS claims remain outside this verdict.

`seal.py` produces `records.json`, `recording.tar.gz` and `manifest.json` from the actual records. It verifies every archived member after writing the archive. No worker result is synthesized.
