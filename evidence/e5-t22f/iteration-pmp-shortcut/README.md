# S/U shortcut diagnostic — not frozen-head acceptance

The recorder started just before commit `41d9ce2c`, so `results.json` reports
activation HEAD `eea8a2c9`. Actual loaded release Wasm SHA-256 is
`360646c69fd0be878d47acfe212fc63353fdd80ccd5d690bd6e2bfc5da8f28bb`, byte-identical
to `git show 41d9ce2c:web/dist/pkg/wasm_vm_wasm_bg.wasm`. Do not rewrite the
recording's head or present it as the final frozen run. No runtime semantics
changed while it ran; fixture and final acceptance-harness work continued.

Command: the C guest-mode driver with `E5_T22C_ITERATION=1`, `E5_T22C_PROFILE=1`,
`E5_T22C_CPU_PROFILE=1`, `E5_T22C_INTERACTIVE=0`, image directory
`target/e5-t22c/desktop-image-solid-v7`, chunk directory
`target/e5-t22c/chunks/desktop-solid-v7`, output
`target/e5-t22f/iteration-pmp-shortcut`. Some deterministic fixture builds overlap
boot; final timing acceptance is separate and unprofiled. This records all seven
real mode/client/marker checks, not E5-T22c's two-second success (still unmet).

CPU-name recovery uses the same wasm-bindgen 0.2.126 / wasm-opt 117 `-O -g`
procedure documented in the prior C CPU recording, with output
`target/e5-t22f/symbols/named.wasm`. The unchanged symbolizer requires equality
of every non-custom section before using names. Its `cpu-summary.json` binds
all raw input profiles and the recorded release module. Maximum resize spends
0.35% of sampled time inside `sync_pmp_code_permissions`, versus 30.71% before.
