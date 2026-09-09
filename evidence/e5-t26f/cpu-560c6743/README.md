# Exact-runtime CPU localization

Diagnostic harness head: `560c67431d0dcbae24fef7fda4af84df887d0751`.
This captures the owned whole-machine worker, not a different profiling build.
It remains `acceptance: false`; no runtime policy or acceptance deadline changes.

```sh
E5_T26F_HEADED=1 E5_T26F_REQUIRE_HEAD=560c67431d0dcbae24fef7fda4af84df887d0751 \
E5_T26F_DIAGNOSTIC=reuse E5_T26F_DIAGNOSTIC_CPU=1 \
E5_T26F_DIAGNOSTIC_PROFILE=/private/tmp/e5-t19a-recovery-browser.zziUlb \
E5_T26F_DIAGNOSTIC_PORT=61627 E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5 \
E5_T26F_OUT=evidence/e5-t26f/cpu-560c6743 \
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 \
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json \
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

LATENCY is absent: no periodic scheduler/JIT probes accompany CPU sampling.
The retained isolated iteration is
`/private/tmp/e5-t19a-recovery-browser.zziUlb/iteration-fifqkX/profile`.
Served-runtime binding remains
`75000f36186a075ede719bdd16f1fb953b36830bd23ff3ea7ac29c64bd97297c`.
Original restore timestamp is `1162.2700001001358`; CPU sampling begins before
typing, at page observation `1934.7549999952316`, and stops after immediate PCM
and the original interaction boundary have been captured. The final interaction
observation is 4824.625 ms after restore, so the unchanged two-second assertion
fails (exit 1). Actual `sh /tmp/a` completes with 1440 fresh non-silent PCM frames,
its conditional green marker, and next prompt. No new boot or PREPARE error.

## Offline name authentication

```sh
/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen \
  --target web --out-dir /private/tmp/e5-t26f-symbols.SwJqTX --out-name wasm_vm_wasm \
  target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm
/Users/blamy/Library/Caches/.wasm-pack/wasm-opt-50385c9e73ccee70/bin/wasm-opt \
  -O -g /private/tmp/e5-t26f-symbols.SwJqTX/wasm_vm_wasm_bg.wasm \
  -o /private/tmp/e5-t26f-symbols.SwJqTX/named.wasm
node tools/verify/e5-t22c-symbolize-cpu.mjs \
  web/dist/pkg/wasm_vm_wasm_bg.wasm /private/tmp/e5-t26f-symbols.SwJqTX/named.wasm \
  evidence/e5-t26f/cpu-560c6743 evidence/e5-t26f/cpu-560c6743
```

The existing symbolizer checks all eleven non-custom sections for byte equality
before mapping 1884 names. Release SHA-256 is
`551206882e7e3ec605dfe04571e53046a81678ebd542fdccafc2c08d8188c229`;
named companion SHA-256 is
`54b350e9b9f628313ad2784886ed8749709a41162e6e3aa7663b703d30b37232`.
Only the release was served. The summary includes authenticated input digests,
section hashes, names, and time-weighted self/inclusive sample rankings.

## Interpretation

3244 samples account for 4,056,447 microseconds. `run_traced` accounts for 92.251%
inclusive / 11.832% self. `try_jit_block` is 27.926% inclusive; its nested
`BrowserExecutor::execute_with_budget` is 16.791% inclusive / 11.110% self.
`Hart::execute` is 14.968% inclusive, `next_micro_op` 16.217% inclusive,
`sync_plic` 5.619% self, and `BlockDiscovery::on_block_entry` 5.181% self.
Inclusive percentages overlap and must not be added as independent costs.
These samples localize a mixed execution/dispatch workload; no measured single
subroutine improvement or clean timing success is claimed. Profiling perturbs
performance, and any eventual runtime candidate needs unprofiled acceptance.

The exact owned-worker adapter passed its separate 300 ms synthetic Chromium
test, including rejection of a wrong worker URL. The prior 49 helper tests pass;
additional CPU-isolation regression tests were being added in the test file
during this diagnostic, without changing the frozen runner or served runtime.

## Canonical evidence digests

- `interaction-cpu.json`: `fbab2f35ceda24ea0bdb9f171f12269db984307ee93e81e3c42a4e47901d4c7b`.
- `cpu-summary.json`: `a4c779b3d81606ac167fc6f465f5ffbc38ab1ef7303963dd6c930e4c565363d1`.
- `failure-post-restore-interaction-checks.json`: `457b094c5157a274dee64f28562bf42d83b0c85a647c6e3f18ada4cebdea645a`.
- Inspected PNG with the same prefix: `f50e85d164e63a0581edf9c705702991634c03e47b99563d4ba89cfae8cf11f3`.
- Server log with the same prefix: `f3f94da45b895b4deba982e0df99f1f403f9e0e8efa2dbbab25a1d09005bd2de`.

No runtime deployment, PR merge, Omarchy disk change, or Epic 6 work occurred.
