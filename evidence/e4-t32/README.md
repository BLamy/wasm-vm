# E4-T32 worker submission evidence

Status: **implemented; awaiting a fresh adversarial verifier**. This document records the frozen
worker submission; it is not a verifier verdict.

## Claim and honest boundary

The demo now defaults Linux to a whole-machine Web Worker without requiring
`SharedArrayBuffer`. The page and worker use a versioned explicit controller protocol, byte
transfers retain exact private ownership, lifecycle/terminal work is serialized, and the public
`runChunk` JIT work is cooperatively bounded. `?worker=0` remains the explicit main-thread fallback.

The measured production default is the fast interpreter with JIT off. The selected JIT path remains
available through `?jit=1&jitThreshold=512` and proves positive translated execution, but it is not
silently presented as faster. A fresh warm Node process is still about **21 seconds to first output**
and about **25 seconds to completion**, not instant. Making the real restored Node workload faster
is the separate E4-T34 short-block/runtime task; this submission claims worker parity and browser
responsiveness, not that acceleration target.

## Frozen revisions

- Runtime/evidence head: `aca44846c85ea1e07c9c6d7534203fbab3f3b9f5`.
- Final harness-only head: `2b2c34018cfdc546bb32f7f5d6c27e52d89301cc`.
- The only change after the runtime/evidence head updates two stale async browser tests:
  generation-qualified download identity and awaited worker timekeeping pause/resume. It changes no
  runtime, built Wasm, or deployable bytes.
- Built Wasm at both heads: SHA-256
  `6c2f93745877550b74c031d0d170539a1b29cc910aabdf09c7239394455c64a1`.

Commit chain:

```text
f253da3 perf(web): default Linux to whole-machine worker
ba50064 build(web): refresh whole-worker dist
0394a7c docs(web): mark bounded JIT handoff verified
1e6eabc build(web): publish E4-T33 roadmap status
aca4484 test(web): waive only benchmark favicon 404
2b2c340 test(web): await worker transfer and timekeeping state
```

## Exact restored-Node matrix

The accepted run used a headed, foreground Chromium browser, two counterbalanced restore sessions
per variant, two fresh processes per session, a pure-JS Window/Worker CPU preflight before and after
each slot, and the user's exact non-echo-spoofable command:

```sh
cd web
E4T32_NODE_BENCH=1 \
E4T32_NODE_ASSET_DIR=/private/tmp/wasm-vm-node-profile.dN7cbx/r2-node \
E4T32_NODE_EVIDENCE_DIR=/Users/brettlamy/Dev/wasm-vm/evidence/e4-t32/node-walltime-aca4484 \
npx playwright test tests/e4-t32-node-walltime.spec.js \
  -g 'same-head worker interpreter parity'
```

Inside the guest, every timed sample executes exactly:

```sh
node -e 'console.log(3)'
```

The output oracle requires a runtime-only standalone `3` line and a PID/exit marker that cannot be
matched in the terminal's echoed source. Every accepted session restored the pinned node-Alpine
snapshot. The immutable local mirror contains 2,400 distinct chunks / 314,572,800 bytes and uses
manifest SHA-256 `ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1`;
the matrix asserted zero `r2.dev` requests.

Result: **PASS**, six accepted clean slots, 14.5 minutes total.

| Metric | main interpreter | worker interpreter | worker/main |
|---|---:|---:|---:|
| first-output median, all processes | 54,449.480 ms | 54,610.885 ms | 1.002964 |
| completion median, all processes | 57,974.943 ms | 58,180.648 ms | 1.003548 |
| first process after restore | 88,009.492 ms | 88,105.447 ms | 1.001090 |
| completion after restore | 91,066.390 ms | 91,144.123 ms | 1.000854 |
| subsequent-process first-output median | 20,916.097 ms | 20,972.972 ms | 1.002719 |
| subsequent-process first-output max | 20,973.975 ms | 21,158.030 ms | 1.008775 |
| max output-to-completion stretch | 4,032.085 ms | 4,069.280 ms | 1.009225 |

Every worker ratio is below the task's 1.10 ceiling. Worker-interpreter rAF p99 was at most
18.655 ms. The synchronized sustained-load probe observed terminal input in 114.030 ms and a cheap
controller RPC in 53.175 ms. The selected `jitThreshold=512` sessions retired 134,282,010 guest
instructions through JIT blocks and executed 24,980,311 blocks during the measured processes, but
their subsequent-process first-output median was 21,616.047 ms, slower than worker interpreter;
therefore JIT is not the production default.

Durable artifacts under `evidence/e4-t32/node-walltime-aca4484/`:

- `E4T32_NODE_RESULTS.json`: SHA-256
  `638fc97e4b547a06c0b4f791d0d97535337ec7c211ebd71edacee0d1d4715a20`.
- `E4T32_NODE_AGGREGATE.json`: SHA-256
  `931e4c1c78e5ca60d578790fe79cbf2fa30231ddf52b1d3af69dc1ce908719a4`.
- `E4T32_NODE_LEDGER_V2.json`: physical SHA-256
  `787e44783bfe73a1e716661e8e9da5d6e00715b660504970faaae9838c02d130`;
  canonical logical SHA-256
  `f3e584282ebe150fce9e128b126aa6502e6264334c2ad7653a24fd9ad0d1bea0`.
- Candidate identity SHA-256
  `65d3b42357f3074d7eca008390a31844ad1060b8c724d17315f2dc230a4b124c`.

## Browser proof

`make web-build` passed at final harness head `2b2c340`. A fresh COOP/COEP server on port 8179
loaded the default BusyBox whole-worker path. The visible demo reached a real prompt, ran
`echo __E4T32_BROWSER_OK`, and displayed the truthful policy line:

```text
execution: whole-machine-worker; fast interpreter; JIT off; ... quantum 500000
```

The separate hidden compliance harness completed in 8.7 seconds with 126 passed, 0 failed, and all
126 result-map entries in `pass`. Browser console capture contained zero warnings and exactly one
error: the explicitly permitted `/favicon.ico` 404, with no other page or console error.

Artifacts:

- `browser/whole-worker-demo.png`: SHA-256
  `169887373168405fcb2c40bda2be39e004b64b5a7550e059d6f2d953d7272273`.
- `browser/e4-t32-compliance-126-of-126.png`: SHA-256
  `5089dbd32a21d9104400ae04a68cfcee586a5586243e3ddb07ea06e832b5b6ad`.
- `browser/e4-t32-compliance-result.json`: SHA-256
  `bca89af7d20eff8326cf7a2f6cc9c4d16594249ad0b8eee3b0476bc37438c98f`.
- `browser/e4-t32-compliance-console-errors.txt`: SHA-256
  `eff5ae9522572142460766d7acd24afca9001144f81e5c80c985f2534c33120f`.
- `browser/roadmap-e4-t32-implemented.png`: SHA-256
  `73a3af61f41ba4e1b36d939e019c68ad743dd1fee5f391dcae761f35ff856a34`.

The dynamic roadmap/task surface reports E4-T32 `implemented`, while the retained legacy static
capability row remains `in-progress` until an independent verifier rules. E4-T33 remains verified.
The refreshed in-app browser rendered 138/329 tasks, the E4-T32 implemented card, E4-T34 still
pending, and E4-T33 verified with an empty page-console log.

The same deployable bundle was published to the immutable Cloudflare preview
`https://ebbb3c24.wasm-vm.pages.dev` and the production alias `https://wasm-vm.pages.dev`.
`/app.html?guest=busybox&nosw&testHooks=1` rendered the 138/329 roadmap and restored BusyBox through
`whole-machine-worker` to a real `~ #` / `guest ready` state with an empty page-console log.

## Host-layer rr-soft evidence

The Linux source manifest matched runtime head `aca4484` across 403 tracked files (SHA-256
`b3fcf438fe0a3869ab946837537afbea33532a78d1900ddbe5dccbe75baab34e`).
All runs used rr-soft 5.9.0 with `rr record -W --chaos`, were packed, re-hashed after transfer, and
replayed successfully with byte-identical output. The committed replay instructions and event
anchors are in `evidence/e4-t32/rr-soft-EVIDENCE.md` (SHA-256
`4ee0ad6478802c2ae842dfa2f2f098c3677e10dc8610285773ef9e18a9c597c3`); the packed local traces
remain gitignored under `rr-traces/e4-t32/`.

- `e4-t32-core-budget-chaos`: 1/1 pass. Event 459 observes cooperative budget state; events
  495/511/521 anchor pass/summary/exit. Packed-manifest SHA-256
  `dd06f5027d7feade2708cc0c8caece8ee48614278f0e4442866f465813334e33`.
- `e4-t32-core-terminal-chaos`: 1/1 pass. Event 459 observes terminal `Exited(0)` with zero final
  pumps; events 493/509/519 anchor pass/summary/exit. Packed-manifest SHA-256
  `be2da7c99e0e5ae5d7046a22ae985e6671d3cb33ba6d08457163c1cc82db3119`.
- `e4-t32-protocol-lifecycle-chaos`: 22/22 pass. Events 4678/4682 anchor quiescence admission,
  4709/4713 transfer/stop FIFO, 6104/6122 natural settlement, 6135/6139 fatal-wins cleanup,
  6227/6231 bounded stuck cleanup, 6289/6293 live-pump timeout, 6779-6796 TAP totals, and 7021 exit.
  Packed-manifest SHA-256
  `1b7050b104b8d39a3ad09021d91b414ca12f90af9232dbacbffe0bc7815e6c8a`.

## Deterministic and focused gates

The frozen runtime passed:

- `cargo fmt --all -- --check` and affected strict clippy for core, Wasm, JIT, and CLI crates.
- `cargo test -p wasm-vm-core`, including the eight async-compile budget/eventual-progress attacks.
- full `wasm-pack test --node crates/wasm`.
- `node --test web/tests/e4-t32-worker-protocol.test.mjs`: 22/22.
- event-sourced Node ledger/store/journal/identity/failure suites: 63/63.
- whole-worker browser proof including explicit selected JIT, default interpreter, timer fallback,
  worker failure, start-paused parity, cross-flavor ownership, and teardown: 9/9.
- final harness-sensitive browser set:
  `npx playwright test tests/e3-t21c-file-transfer-ui.spec.js tests/timekeeping.spec.js
  tests/e4-t32-file-transfer-async.spec.js tests/e4-t32-whole-worker.spec.js`: 25/25 in 1.3 minutes.
- fresh final `make web-build` and the one-page 126/0 compliance proof described above.

The workspace all-features clippy wall still contains pre-existing unified-feature debt outside this
task; affected crates passed and this submission does not claim that unrelated debt is repaired.

## Fresh-verifier handoff

The verifier should attack the runtime head `aca4484`, carry forward the final two-file harness-only
layer `2b2c340`, replay all three rr traces, and independently inspect the Node ledger identity and
six accepted slots. In particular, it should try silent Worker termination, held RPC/cleanup races,
controller generation reuse, background/resume heartbeat grace, selected-JIT input during compile
pressure, and same-command main/worker state/output parity. Only the fresh verifier may change this
task from `implemented` to `verified`.
