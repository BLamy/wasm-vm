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
- Final Node evidence-harness head: `6155f216d9c347fb44e58cbaa13b81eda357c87e`.
- `8302ea7` durably records the exact Node command, standalone output, child PID, concrete completion
  marker, bounded terminal transcript, exit status, and timing for every process. `6155f21` adds the
  immutable absolute CPU-capacity admission rule used live, in the ledger, and during crash recovery.
- No execution runtime, JIT policy, or built Wasm byte changed after `aca4484`; later changes are
  tests, evidence, and task/roadmap metadata, so the held browser, guest, and rr evidence remains
  incremental-valid.
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
ab3e6fc chore(e4): submit whole-worker evidence
3a497a5 chore(e4): record E4-T32 verifier evidence gap
8302ea7 test(web): persist exact Node process oracle
6155f21 test(web): bind Node CPU calibration capacity
```

## Exact restored-Node matrix

The accepted run used a headed, foreground Chromium browser, two counterbalanced restore sessions
per variant, two fresh processes per session, and the user's exact command. A pure-JS Window/Worker
CPU calibration ran before and after every slot and had to satisfy both the original relative rules
and the new immutable absolute-capacity rule:

```sh
cd web
E4T32_NODE_BENCH=1 \
E4T32_NODE_ASSET_DIR=/private/tmp/wasm-vm-node-profile.dN7cbx/r2-node \
E4T32_NODE_EVIDENCE_DIR=/private/tmp/e4t32-node-absolute-6155f216.o0xM1c \
npx playwright test tests/e4-t32-node-walltime.spec.js --headed --workers=1
```

Inside the guest, every timed sample executes exactly:

```sh
node -e 'console.log(3)'
```

The shell source contains placeholders, never the concrete process marker. After launching the exact
Node argv in the background it captures `$!`, waits for that child, and emits a runtime-only marker
containing the attempt-derived sequence, positive Node PID, and exit status. The oracle requires a
standalone `3` before that exact marker. Every run durably preserves `nodeCommand`, `nodePid`,
`nodeSequence`, `outputLine`, `completionMarker`, the sanitized at-most-512-character
`oracleTranscript`, `exit`, and both timings in its session sidecar, accepted ledger, and final
result. Each session's two PIDs are distinct; the attempt sequence scopes PID reuse across restored
guests. Missing, reordered, mismatched, nonzero-exit, or echo-spoofed evidence fails closed.

Every accepted session restored the pinned node-Alpine snapshot. The immutable local mirror contains
2,400 distinct chunks / 314,572,800 bytes and uses manifest SHA-256
`ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1`; the matrix asserted zero
`r2.dev` requests. Candidate identity SHA-256 is
`86a6c601fe97addd56e8e5d8aacbb0242183ea5b6730ed0e50dfdf22702cd706`.

Result: **PASS**, six accepted clean slots, no discarded attempt, 14.7 minutes total.

| Metric | main interpreter | worker interpreter | worker/main |
|---|---:|---:|---:|
| first-output median, all processes | 53,723.223 ms | 53,997.735 ms | 1.005110 |
| completion median, all processes | 57,222.475 ms | 57,482.462 ms | 1.004543 |
| first process after restore | 87,083.697 ms | 87,370.895 ms | 1.003298 |
| completion after restore | 90,097.155 ms | 90,381.698 ms | 1.003158 |
| subsequent-process first-output median | 20,827.570 ms | 20,723.350 ms | 0.994996 |
| subsequent-process first-output max | 20,964.070 ms | 20,880.510 ms | 0.996014 |
| max output-to-completion stretch | 3,995.000 ms | 3,969.705 ms | 0.993668 |

Every worker ratio is below the task's 1.10 ceiling. Worker-interpreter rAF p99 was at most
18.585 ms. The synchronized sustained-load probe observed terminal input in 175.220 ms and a cheap
controller RPC in 51.085 ms. The selected `jitThreshold=512` sessions retired 132,315,918 guest
instructions through JIT blocks and executed 24,458,996 blocks during the measured processes. Their
subsequent-process first-output median was 21,855.890 ms, 4.94% slower than main interpreter;
therefore JIT is truthfully exercised but is not the production default.

### Immutable CPU-capacity admission

The capacity reference is the tracked ledger at
`ab3e6fc4ee68179a197d9f82d3a124a043d9e27d:evidence/e4-t32/node-walltime-aca4484/E4T32_NODE_LEDGER_V2.json`.
Its physical SHA-256 is `787e44783bfe73a1e716661e8e9da5d6e00715b660504970faaae9838c02d130`
and its canonical logical SHA-256 is
`f3e584282ebe150fce9e128b126aa6502e6264334c2ad7653a24fd9ad0d1bea0`.
The harness verifies those exact commit bytes, validates all raw sample pairs and stored summaries,
then recomputes the ordinary median of all 12 accepted pre/post phase medians separately:
329.125 ms for Window and 329.7250000014901 ms for Worker. Browser binary, headed policy,
Playwright/Node versions, host/kernel, benchmark kernel, iterations, warmups, order, and policy
version are identity-bound.

Both raw realm medians must independently fall within reciprocal factors `[1/1.05, 1.05]` of that
reference before **and** after each slot, in addition to the relative checksum/realm/pair rules. The
12 matrix phases ranged from 316.800–343.750 ms for Window and 319.900–337.850 ms for Worker;
absolute ratios ranged 0.962552–1.044436 and 0.970202–1.024642 respectively. The standalone gate
recorded 317.550/319.700 ms, absolute ratios 0.964831/0.969596, and 8/8 relative pairs. Canonical
evaluation is shared by the live path, ledger finish, and crash recovery; serialized `clean` or
derived medians are never trusted. A dirty preflight runs no Node process, and a dirty postflight
immutably excludes the completed session.

This closes a prior evidence-admission failure: the relative-only harness could accept a globally
capacity-degraded host whenever Window and Worker slowed together, then misclassify a Node timing
failure as a product refutation. The reproduced 492/496 ms case demonstrates that blind spot. That
diagnostic verdict is preserved but is not combined with this ledger; the absolute rule now marks
the same condition calibration-contaminated before any product verdict.

### Durable artifact inventory

The unchanged 46-file, 1,070,124-byte bundle is committed under
`evidence/e4-t32/node-walltime-6155f21/`:

- `E4T32_NODE_RESULTS.json`: SHA-256
  `a656321d6fad9fa51b31b57e8f6aa429242f511f90e5497fd2c63c2fb3bee6d3`.
- `E4T32_NODE_AGGREGATE.json`: SHA-256
  `87f82788d7f7583e4e8aad7ffb6c21732c2b8dabb4beb99e611427f01d09ece4`.
- `E4T32_NODE_LEDGER_V2.json`: physical SHA-256
  `b6c62884c097d44c259d662fcec1defe5fe997f4e9216117b98d0d0a7778bfdd`;
  canonical logical SHA-256
  `8d26f4ecf80310f729b7cbd66f3ceb4f8077e2990c458fed7359c7486cce6768`.
- `E4T32_CPU_PREFLIGHT_standalone.json`: SHA-256
  `7dc066a690298a765f76d1246b1b58bc34a1d1d68790c1155c990d0e25e5ff0a`.
- Auditor canonical `{path,bytes,sha256}` root inventory SHA-256 (records sorted by relative path,
  then stable JSON serialized with recursively sorted object keys)
  `74ee019c19c0ea1889d1e7694547998c9f18e72b4b6c26cf8b9a7b727ee0c0ff`.
- Sorted `sha256␠␠path\n` inventory text SHA-256
  `fc5ce66a24e16f61c4dd0c7e3d63050f25d4c19fa1fae1c8e5fdb623779be0c0`.
- Attempt-sidecar canonical manifest SHA-256
  `0de10dc6e1fee3043dab7e5ad22d56b2f66a363c689d72845a00eac0f82c81cb`.
- The 12 slot-preflight canonical manifest SHA-256
  `20a10382a36f7cfed0dcba9cea2b1670107981c184713f7aa788cc0a3d72d83f`.

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
- event-sourced Node calibration/oracle/ledger/store/journal/identity/failure suites: 81/81 at
  evidence-harness head `6155f21`.
- whole-worker browser proof including explicit selected JIT, default interpreter, timer fallback,
  worker failure, start-paused parity, cross-flavor ownership, and teardown: 9/9.
- final harness-sensitive browser set:
  `npx playwright test tests/e3-t21c-file-transfer-ui.spec.js tests/timekeeping.spec.js
  tests/e4-t32-file-transfer-async.spec.js tests/e4-t32-whole-worker.spec.js`: 25/25 in 1.3 minutes.
- fresh final `make web-build` and the one-page 126/0 compliance proof described above.

The workspace all-features clippy wall still contains pre-existing unified-feature debt outside this
task; affected crates passed and this submission does not claim that unrelated debt is repaired.

## Fresh-verifier handoff

The verifier should attack runtime head `aca4484`, carry forward the held browser/rr results whose
product boundary is unchanged, and independently inspect evidence-harness head `6155f21` plus the
new 46-file Node bundle. It should recompute both inventory manifests, physical/logical ledger
digests, absolute reference medians from the exact `ab3e6fc` commit bytes, all 12 pre/post admission
decisions, the 12 PID/marker/output transcripts, aggregate timings, and worker/main ratios. It should
also retain the earlier attacks on silent Worker termination, held RPC/cleanup races, controller
generation reuse, background/resume heartbeat grace, selected-JIT input during compile pressure,
and same-command main/worker state/output parity. Only the fresh verifier may change this task from
`implemented` to `verified`.
