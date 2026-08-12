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
- Final authoritative raw-frame harness head:
  `6b5db489ba451b279490277a8bd983f563c239c1`.
- `6155f21` supplies the immutable absolute CPU-capacity admission rule. `5b0f0bc` preserves
  bounded raw terminal bytes, and `6b5db48` binds the oracle to the exact default-TTY byte grammar,
  Node PID, zero exit, offsets, and content hash.
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
ca0753b chore(e4): promote final whole-worker evidence
08378a1 chore(e4): retain Node raw-evidence gate
5b0f0bc test(e4): preserve raw Node terminal oracle
6b5db48 test(e4): bind Node oracle to TTY bytes
```

## Exact restored-Node matrix

The accepted run used a headed, foreground Chromium browser, two counterbalanced restore sessions
per variant, two fresh processes per session, and the user's exact command. A pure-JS Window/Worker
CPU calibration ran before and after every slot and had to satisfy both the original relative rules
and the new immutable absolute-capacity rule:

```sh
cd web
env -u E4T32_CPU_PREFLIGHT_ONLY \
  -u E4T32_NODE_DIAG \
  -u E4T32_NODE_DIAG_PROGRESS \
  -u E4T32_NODE_DIAG_WORKER_FIRST \
  -u E4T32_NODE_VARIANTS \
  E4T32_NODE_ASSET_DIR=/private/tmp/wasm-vm-node-profile.dN7cbx/r2-node \
  E4T32_NODE_ASSET_BASE=/e4t32-node-assets \
  E4T32_NODE_EVIDENCE_DIR=/private/tmp/e4t32-node-yellow-matrix-6b5db48.3s4nW6 \
  E4T32_NODE_BENCH=1 \
  npx playwright test tests/e4-t32-node-walltime.spec.js \
    --grep 'same-head worker interpreter parity plus truthful JIT/scheduler evidence'
```

Inside the guest, every timed sample executes exactly:

```sh
node -e 'console.log(3)'
```

The interactive shell starts one background `sh -c`; that inner shell prints BEGIN(token,$$) and
then `exec`s the exact Node command. The outer shell captures `$!`, waits, and prints
DONE(token,$!,exit). Consequently inner `$$`, outer `$!`, and the Node PID are identical, while
BEGIN necessarily precedes Node output. The echoed source contains placeholders, never a concrete
token, PID, or completion marker.

The authoritative `e4-t32-node-byte-frame-v2` / `tty-yellow-v1` record is at most 512 raw bytes and
accepts exactly:

`BEGIN(token,pid) + EOL + ESC[33m + 3 + ESC[39m + EOL + DONE(token,same-pid,0) + EOL`

EOL is uniformly LF or CRLF. The harness performs no generic ANSI stripping and accepts no plain,
noisy, mixed-newline, truncated, reordered, or appended alternative. It persists canonical base64,
byte length, SHA-256, newline style, and exact half-open offsets for both markers, all three line
endings, ANSI open/reset, and the value byte. First-output time is recorded only after the colored
`3` line ending; completion is recorded at DONE's line ending. All twelve accepted frames were
112-byte CRLF records and independently revalidated from their persisted bytes.

Every accepted session restored the pinned node-Alpine snapshot. The immutable local mirror contains
2,400 distinct chunks / 314,572,800 bytes and uses manifest SHA-256
`ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1`; the matrix asserted zero
`r2.dev` requests. Candidate identity SHA-256 is
`c11d11e9ac3ce04fffded404245b3b9e19545ed06bc7cbc44b0849cd8c0f374c`.

Result: **PASS**, six accepted clean slots, no discarded attempt, 14.6 minutes total.

| Metric | main interpreter | worker interpreter | worker/main |
|---|---:|---:|---:|
| first-output median, all processes | 53,963.065 ms | 54,870.443 ms | 1.016815 |
| completion median, all processes | 57,494.005 ms | 58,398.293 ms | 1.015728 |
| first process after restore | 87,425.247 ms | 88,449.697 ms | 1.011718 |
| completion after restore | 90,396.733 ms | 91,466.545 ms | 1.011835 |
| subsequent-process first-output median | 21,235.215 ms | 21,342.470 ms | 1.005051 |
| subsequent-process first-output max | 21,347.115 ms | 21,644.920 ms | 1.013951 |
| max output-to-completion stretch | 4,090.100 ms | 4,049.470 ms | 0.990066 |

Every worker ratio is below the task's 1.10 ceiling. Worker-interpreter rAF p99 was at most
18.660 ms. The synchronized sustained-load probe observed terminal input in 113.925 ms and a cheap
controller RPC in 51.095 ms. The selected `jitThreshold=512` sessions retired 136,016,872 guest
instructions through JIT blocks and executed 25,369,611 blocks during the measured processes. Their
subsequent-process first-output median was 22,086.932 ms, 4.01% slower than main interpreter;
therefore JIT is truthfully exercised but is not the production default.

All frames are 112-byte CRLF `tty-yellow-v1` records:

| Slot | PID | Raw frame SHA-256 | PID | Raw frame SHA-256 |
|---|---:|---|---:|---|
| p0 main interpreter | 839 | `591c905ae15198469856367ee18a9e5d05e7105974bfa7f884b3ac8b6d6c070a` | 846 | `d31c32c1630017a440fc036312d9ce9317d8a4c6fc262e91bfc447055b8732cb` |
| p0 worker interpreter | 838 | `4c49abadb52296d457667e9ec9a661e83c3a07bc4f8f857020bb3c4e7c79f13c` | 846 | `191ccf6520a7dcba9c37d965ea70813ed2e062da52d09911e088b6e69a4bee3e` |
| p0 worker JIT512 | 838 | `58770630d43da1ce6f3d8d60f2e90dc47df549baa67840084947cf9b5225160b` | 846 | `2439550f8e90813a4bc0ee89ad5eb569f907d518c24d3009a28c19ed208f6b98` |
| p1 worker JIT512 | 838 | `5b0339d4708582cfdb02009ccc1f441936bf9e11092a61461a7de3e34ad000ce` | 846 | `4a1592283ac15ff7ec5d9c641180932ee77a893a60b62a9553e8f38ff8f14015` |
| p1 worker interpreter | 838 | `d5c28471290b449bf590436081c4b8cd52ef2255842005e491fdbf50035e3b4f` | 846 | `d0a12e1c9f2bd7e514e6ff2bc127221363f6f313461715ab33492f3570ba726d` |
| p1 main interpreter | 839 | `e28a243a3fbcdedcfbf1d349a49c67428df9f3c55a4b176df1198bcd87b4306a` | 846 | `d1d4a4ef123a471d89f7688e6d6b66fcd75eae41f87af7a3bc71686c0461a1c9` |

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
12 matrix phases ranged from 316.850–333.850 ms for Window and 318.600–331.650 ms for Worker;
absolute ratios ranged 0.962704–1.014356 and 0.966260–1.005838 respectively. The standalone gate
recorded 316.550/317.000 ms, absolute ratios 0.961793/0.961407, realm ratio 1.001422, paired ratio
0.999525, and 8/8 relative pairs. Canonical
evaluation is shared by the live path, ledger finish, and crash recovery; serialized `clean` or
derived medians are never trusted. A dirty preflight runs no Node process, and a dirty postflight
immutably excludes the completed session.

This closes a prior evidence-admission failure: the relative-only harness could accept a globally
capacity-degraded host whenever Window and Worker slowed together, then misclassify a Node timing
failure as a product refutation. The reproduced 492/496 ms case demonstrates that blind spot. That
diagnostic verdict is preserved but is not combined with this ledger; the absolute rule now marks
the same condition calibration-contaminated before any product verdict.

### Durable artifact inventory

The unchanged 46-file, 1,130,926-byte bundle is committed under
`evidence/e4-t32/node-walltime-6b5db48/`:

- `E4T32_NODE_RESULTS.json`: SHA-256
  `4cdc3563489c36bd7955991db6c879b32dd2d5595583ad1f591334b935699bc9`.
- `E4T32_NODE_AGGREGATE.json`: SHA-256
  `fc49673f493f4eb6f915e7f9ee6516fd07f50ee660ad0192c9a8bb22f8f1174d`.
- `E4T32_NODE_LEDGER_V2.json`: physical SHA-256
  `298b4445d151e6f096deba21eb57ca3b80d93a4de2cc7d3d0a0e42227d586308`;
  canonical logical SHA-256
  `fe58edde486305e9d76209a518df24b60a67e8d47cd4d6130e2399dbf7bfa61a`.
- `E4T32_CPU_PREFLIGHT_standalone.json`: SHA-256
  `9db9f356a184021879694aab5859c673cefffea75c99b92731f9057469bed5ca`.
- Auditor canonical `{path,bytes,sha256}` root inventory SHA-256 (records sorted by relative path,
  then stable JSON serialized with recursively sorted object keys)
  `3f69ac799dd8498ec821670e5979aad16b564ee9d37328763ee13748f9e2f575`.
- Sorted `sha256␠␠path\n` inventory text SHA-256
  `59d5a665feae371ad7ef77a636ac5fac14b337152d733242748f96f8180a351a`.
- Attempt-sidecar canonical manifest SHA-256
  `1939faa7afac4c8e91dbd8fe87d5343d4332ab5d3af05603fc914e30742c9cc8`.
- The 12 slot-preflight canonical manifest SHA-256
  `5e70769570a8c58b5acff429929e41e6f735d1247444c02377eeaab2115b9498`.
- The 13-file preflight canonical manifest, explicitly including the standalone gate, SHA-256
  `d971c948e08bcfe3a9789012ec56e38904fd7490728e2ccfcbaac6a7b272f234`.

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
- event-sourced Node oracle/calibration/ledger/store/journal/identity/failure suites: 89/89 at
  authoritative raw-frame head `6b5db48`.
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
product boundary is unchanged, and independently inspect evidence-harness head `6b5db48` plus the
new `evidence/e4-t32/node-walltime-6b5db48/` 46-file Node bundle. It should recompute both inventory
manifests, physical/logical ledger
digests, absolute reference medians from the exact `ab3e6fc` commit bytes, all 12 pre/post admission
decisions, the 12 PID-bound raw byte frames, aggregate timings, and worker/main ratios. It should
also retain the earlier attacks on silent Worker termination, held RPC/cleanup races, controller
generation reuse, background/resume heartbeat grace, selected-JIT input during compile pressure,
and same-command main/worker state/output parity. Only the fresh verifier may change this task from
`implemented` to `verified`.
