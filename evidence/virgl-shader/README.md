# E6-T10a shader boundary evidence

Frozen implementation: `6993efb1540cf7f5a01f6c82b8dac32cee734b39`.
Parent layer: `1d0e9c407cfbbf31dde02b116e301122540c5789`.

This proves the isolated, bounded TGSI-to-GLSL ES300 compiler and its binding
metadata. No guest executes in this test, no device advertises 3D capabilities,
and no desktop acceleration or MIPS improvement is claimed. Emulator sources,
default 2D behavior, Rust dependencies and production web files are unchanged.

## Recorded acceptance

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc \
  VIRGL_SHADER_EVIDENCE_DIR=evidence/virgl-shader/worker make verify-E6-T10a
```

`worker/acceptance.log` records the compiler versions, builds and native
sanitizer run. `worker/receipt.json` pins all 93 source files, built artifacts,
and the compiler/linker/optimizer files. The native test passed 8,769 calls,
including 4,096 seeded mutations (4,095 rejected, one still valid), all six
literal shader fixtures, truncations and repeated byte-identical recovery.

`worker/browser/report.json` records the actual served Wasm/JS hashes, Chrome
154.0.8037.93 identity and command line, Apple M4 Max ANGLE Metal hardware,
translated shaders, reflected bindings, pixel results and errors. Nine draws
matched 4,336 exact interior pixels; 13 rejection cases and 416 recovery checks
passed with zero browser errors. `worker/browser/browser.png` shows those draws.

Wasm SHA-256:
`4263ea2ec1fddc8b19bf9922879eb7397ab23de9e1cce205a88a1da94e4528cb`.

## Cold clone and provenance

`cold-clone/` repeats the exact command from a new detached checkout of the
frozen implementation. Only immutable Git objects were shared; no build output,
node_modules or browser profile was copied. `npm ci` installed the pinned browser
harness dependencies. The environment retained only PATH, HOME, TMPDIR, LANG,
LC_ALL, USER, LOGNAME and SHELL, then explicitly set the pinned EMCC wrapper and
the new evidence directory. RUSTFLAGS, CARGO_*, RUST_LOG, compiler flags and
inherited Emscripten/Python/Node overrides were absent.

The cold run passed all the same checks. Every source digest and both generated
Wasm/JS module digests match the worker run. `provenance.json` records the exact
scratch path and commands, those comparisons, unchanged emulator/demo paths,
and independent byte comparisons of all 67 vendored files against `git show
ca50e008863837e094747a69974dde3ae148aeaa:<upstream path>`.

All three generated data files reproduce using the pinned upstream generators:

```sh
PYTHONPATH=/tmp/wasm-vm-virgl-pyyaml-6.0.2 \
  /tmp/wasm-vm-emsdk/python/3.13.3_64bit/bin/python3 \
  renderer/virgl-shader/regenerate.py --check
```

The isolated package directory contains PyYAML 6.0.2; `regeneration.log` records
the matching result. The module README provides a fresh-environment setup.

## Scope and inherited diagnostics

The whitelist and new adapter are the tested boundary. Unmodified upstream
features outside it are rejected before conversion and are not claimed covered.
The native build retains three upstream `sprintf` deprecation warnings and
upstream whitespace verbatim to preserve the source pin. New files pass the
whitespace check when vendor/generated paths are excluded. Unrelated emulator
gates carry forward because their source and dependency boundary are unchanged.
Fresh critic results follow in the task's Verification log.
