---
id: E4-T32
epic: 4
title: Default whole-machine Web Worker with controller parity
priority: 433
status: evidence-needed
depends_on: [E4-T33]
estimate: S
risk: high
capstone: false
---

## Goal

Make the proven whole-`WasmLinux` worker the demo default so CPU/JIT execution, lazy disk fetches,
and persistence pumping do not block paint or input. Replace the generic promise-for-everything proxy
with an explicit asynchronous controller contract and update every UI consumer to honor it.

## Acceptance criteria

- The demo defaults to the whole-machine worker; `?worker=0` selects the legacy main-thread path.
- Boot/JIT/quantum options are passed explicitly from the page, not inferred from the worker script's
  URL, and both accelerated interpreter and selected JIT policy run inside the worker.
- Terminal, pause/resume, persistence, snapshot, chunk stats, and bidirectional file transfer retain
  controller parity, including transferable byte payloads without detached-buffer accounting bugs.
- During a sustained guest workload, main-thread rAF gap is <=20 ms p99 and terminal input remains
  responsive; busybox and node-Alpine restore reach a prompt with zero console errors.
- From a restored node-Alpine guest in a foreground browser, record a non-echo-spoofable fresh
  `node -e` wall-time matrix for main interpreter, worker interpreter, and worker JIT. The worker
  path must not regress first-output or completion median by more than 10% versus the same-head main
  path, while retaining the responsiveness bound; the strict Node speedup is E4-T34's runtime seam.
- Worker failure surfaces a clean fatal state and `?worker=0` remains a working fallback.

## Adversarial verification

Exercise every controller method from the UI, upload/download across the worker boundary, background
and resume the tab, kill the worker, run without JIT/isolation, and compare guest output/digests with
the main-thread fallback. A Promise mistaken for a synchronous value, lost byte buffer, hung boot, or
main-thread long task refutes the change. Benchmark the user's exact one-shot Node shape across
main-thread interpreter, worker interpreter, and worker JIT policies; a worker that paints smoothly
but delays input/output, regresses wall time, or falsely claims translated execution is refuted.

## Verification log

### 2026-08-10 — worker — implemented

Runtime/evidence head: `aca44846c85ea1e07c9c6d7534203fbab3f3b9f5`. Final harness-only
head: `2b2c34018cfdc546bb32f7f5d6c27e52d89301cc`. Full artifact ledger, exact commands,
hashes, rr event anchors, and the verifier attack handoff are in `evidence/e4-t32/README.md`.

The whole `WasmLinux` machine is now the default Worker backend without an SAB requirement;
`?worker=0` remains the explicit main-thread fallback. The page/worker boundary is an explicit
versioned asynchronous controller with exact transferable ownership, FIFO lifecycle/input/RPC,
bounded heartbeat grace, serialized terminal cleanup, and generation-safe UI/file-transfer
consumers. Browser JIT admission is bounded per public cooperative run (at most 8 attempted/submitted
blocks, 64 staged nominations, and one final pump), with eventual backlog progress and exact
profile/accounting evidence. Production defaults honestly to the fast interpreter; explicit
`?jit=1&jitThreshold=512` runs translated work but is not mislabeled as the faster Node policy.

The headed foreground restored-Node ledger executed the non-echo-spoofable exact command
`node -e 'console.log(3)'` across two counterbalanced sessions and two fresh processes per session.
Worker/main ratios were 1.002964 for first-output median, 1.003548 for completion median, 1.000854
for cold completion, 1.002719 for subsequent first-output median, and 1.008775 for subsequent max;
all are below the 1.10 ceiling. Worker rAF p99 was at most 18.655 ms, sustained-load terminal input
arrived in 114.030 ms, and the cheap controller RPC completed in 53.175 ms. JIT sessions executed
24,980,311 blocks / retired 134,282,010 guest instructions through JIT. Result JSON SHA-256:
`638fc97e4b547a06c0b4f791d0d97535337ec7c211ebd71edacee0d1d4715a20`.

The exact-head demo restored BusyBox in the whole-machine worker, accepted a computed shell command,
and truthfully displayed `fast interpreter; JIT off; quantum 500000`. The hidden compliance harness
then passed 126/0 in 8.7 seconds. The console had zero warnings and no error except the exact allowed
`/favicon.ico` 404. Browser screenshot SHA-256 values are
`169887373168405fcb2c40bda2be39e004b64b5a7550e059d6f2d953d7272273` (visible Worker/prompt) and
`5089dbd32a21d9104400ae04a68cfcee586a5586243e3ddb07ea06e832b5b6ad` (126 green tests).
The same bundle deployed at `https://ebbb3c24.wasm-vm.pages.dev` and the production alias; its
`/app.html` restored BusyBox through `whole-machine-worker` to `~ #` / `guest ready` with no page
console entries.

Host evidence on `ssh dev` recorded three packed rr-soft `-W --chaos` traces at the exact runtime
source: the cooperative compile budget (1/1), terminal no-final-pump path (1/1), and complete worker
protocol lifecycle suite (22/22). Packed-manifest SHA-256 values are
`dd06f5027d7feade2708cc0c8caece8ee48614278f0e4442866f465813334e33`,
`be2da7c99e0e5ae5d7046a22ae985e6671d3cb33ba6d08457163c1cc82db3119`, and
`1b7050b104b8d39a3ad09021d91b414ca12f90af9232dbacbffe0bc7815e6c8a`; every trace packed,
re-hashed, and replayed successfully.

Focused gates passed: affected format/strict clippy, full core tests, full Node Wasm tests, protocol
22/22, ledger/store/journal/identity/failure 63/63, whole-worker 9/9, final async transfer +
timekeeping + whole-worker browser set 25/25, `make web-build`, and the 126/0 browser run. The strict
speed target is deliberately not claimed: subsequent Node first output remains about 20.97 seconds
and completion about 25 seconds. E4-T34 owns making the JIT actually accelerate that real workload.
This task remains `implemented` until a fresh verifier attacks the submitted evidence.

### 2026-08-10 — verifier — VERDICT: needs-evidence

- **P8 Node oracle recording — NEEDS EVIDENCE.** Predicted that each accepted fresh `node -e`
  process would leave an independently inspectable non-echo oracle in the frozen artifact. The
  harness matches a standalone `3` and completion marker at
  `web/tests/e4-t32-node-walltime.spec.js:432-475`, but reduces it to timings, `sawExpected`, and
  exit at lines 455-462, then omits the oracle from the durable leg at lines 798-829. Observed ledger
  path `events[1].session.runs[0]` at
  `evidence/e4-t32/node-walltime-aca4484/E4T32_NODE_LEDGER_V2.json:1` has no raw terminal capture,
  concrete marker, command, or process identity; line 437's `$$` is the shell PID, not Node's PID.
  The product claim was not contradicted, but acceptance lines 28-31 explicitly require a recorded
  fresh, non-echo-spoofable matrix. Bind a bounded per-process oracle capture or equivalent guest/host
  trace into the hashed attempt sidecars/ledger, then rerun only that evidence/harness boundary.
- **P1-P7 and P9-P15 — HELD.** Exact ledger identity, six-slot ordering, all 30 sidecars and 12
  preflights, physical/logical/result/aggregate hashes, and parity/JIT math independently recomputed.
  Fresh gates passed core, 85 Node cases, 25 browser cases, the pristine clone, and the bounded
  subarray mutation attack. Selected-JIT sustained-load input/RPC measured 208.990/89.100 ms with
  positive translated execution. rr event 459 exposed the claimed budget state 8/32/32 and terminal
  `Exited(0)` state with zero attempts/final pumps; protocol events 6779-6796 exposed 22 passes and
  zero failures. Full details and commands: `evidence/e4-t32/VERIFIER-REPORT.md`.
- **COVERAGE:** all behavioral hunks map to core/rr, protocol, whole-worker, transfer, or Node
  ledger suites; tooling/static/generated hunks are explicitly waived in the report. No dead or
  unexecuted product behavior was found.
- **SUITE:** no promotion until the recording gap clears. Sabotaging private byte ownership made the
  existing test fail on a detached caller buffer, confirming it is load-bearing.
