# Focused resize CPU recording — diagnostic, not acceptance

Runtime head: `9b656c7f0bdb32fda63edb8e24b89f3f6ee2bdec`.
Image and exact runtime/source digests are in `results.json`. Both profilers
were enabled; the same disposable guest handled all ten modes. Raw CPU profiles
stop at full desktop-edge coverage, before the subsequent guest status queries.
The initial/final GPU, live-client and retained-marker observations are separate
from the RAM-only state digest. All timings exceed the unmodified 2000 ms gate.

Commands to recover readable names offline, without loading a changed module:

```sh
/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen \
  --target web --out-dir target/e5-t22c/symbols --out-name wasm_vm_wasm \
  target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm
/Users/blamy/Library/Caches/.wasm-pack/wasm-opt-50385c9e73ccee70/bin/wasm-opt \
  -O -g target/e5-t22c/symbols/wasm_vm_wasm_bg.wasm \
  -o target/e5-t22c/symbols/named.wasm
node tools/verify/e5-t22c-symbolize-cpu.mjs \
  web/dist/pkg/wasm_vm_wasm_bg.wasm target/e5-t22c/symbols/named.wasm \
  evidence/e5-t22c/iteration-solid-v7-cpu target/e5-t22c/symbol-replay
```

Tool versions: wasm-bindgen 0.2.126, wasm-opt 117. The tool locations are this
machine's installed cache paths; use those same versions elsewhere. Rebuild the
release compiler output at the recorded head if absent. The symbolizer refuses
different non-custom sections, so a later runtime build cannot supply plausible
but incorrect names. `cpu-summary.json` contains input hashes, every non-custom
section hash, names, and time-weighted self/inclusive sample accounting. Custom
debug sections do not execute. There is no alternate runtime or production change.

The two maximum-mode captures contain 30.71% and 30.06% inclusive sampled time
in `Machine::sync_pmp_code_permissions`. This is evidence for investigating
S/U-equivalent PMP re-audits in a separate engine task, not proof of the speedup
of a change that has not run. Guest-PC profiles retain only their top ten buckets
and under-sample JIT-covered instructions; do not infer complete guest-PC coverage.
