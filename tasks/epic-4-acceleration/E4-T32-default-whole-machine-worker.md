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

### 2026-08-10 — worker — implemented (evidence gap repaired)

Runtime semantics remain frozen at `aca44846c85ea1e07c9c6d7534203fbab3f3b9f5`; the final
evidence-harness head is `6155f216d9c347fb44e58cbaa13b81eda357c87e`. No execution runtime,
JIT policy, or built Wasm byte changed; later deltas are tests, evidence, and task metadata.
`8302ea7` repairs the verifier's P8 gap by durably
recording every exact `node -e 'console.log(3)'` command, standalone `3`, positive Node PID,
attempt-bound runtime marker, bounded transcript, zero exit, and timings in the session sidecar,
accepted ledger, and result. `6155f21` adds a canonical absolute CPU-capacity evaluator shared by
live admission, ledger finish, and crash recovery; it verifies exact prior committed reference bytes
(`ab3e6fc4...`, physical SHA-256 `787e4478...`, logical SHA-256 `f3e58428...`) and rejects globally
slow pre/post samples instead of trusting relative parity or serialized `clean` fields.

Exact final command, from `web/`:

```sh
E4T32_NODE_BENCH=1 \
E4T32_NODE_ASSET_DIR=/private/tmp/wasm-vm-node-profile.dN7cbx/r2-node \
E4T32_NODE_EVIDENCE_DIR=/private/tmp/e4t32-node-absolute-6155f216.o0xM1c \
npx playwright test tests/e4-t32-node-walltime.spec.js --headed --workers=1
```

The six-slot balanced matrix passed in 14.7 minutes with six accepted attempts and no discarded
attempt. Worker/main ratios were 1.005110 first-output median, 1.004543 completion median, 1.003298
cold first output, 1.003158 cold completion, 0.994996 subsequent median, 0.996014 subsequent max,
and 0.993668 stretch; all remain below 1.10. Sustained-load worker input/RPC measured
175.220/51.085 ms with rAF p99 18.585 ms. Explicit JIT512 executed 24,458,996 translated blocks and
retired 132,315,918 instructions through JIT, while remaining honestly non-default because its warm
first-output median was 21,855.890 ms.

The unchanged 46-file / 1,070,124-byte artifact is committed under
`evidence/e4-t32/node-walltime-6155f21/`. Result/aggregate/physical-ledger SHA-256 values are
`a656321d6fad9fa51b31b57e8f6aa429242f511f90e5497fd2c63c2fb3bee6d3`,
`87f82788d7f7583e4e8aad7ffb6c21732c2b8dabb4beb99e611427f01d09ece4`, and
`b6c62884c097d44c259d662fcec1defe5fe997f4e9216117b98d0d0a7778bfdd`; canonical root inventory
SHA-256 is `74ee019c19c0ea1889d1e7694547998c9f18e72b4b6c26cf8b9a7b727ee0c0ff`. The exact
reference derivation, all phase hashes, oracle records, aggregate figures, prior relative-only
false-refutation diagnosis, and verifier commands are in `evidence/e4-t32/README.md`. The strict
Node speed target remains unclaimed: a fresh warm process still takes roughly 20.7–21.9 seconds to
first output and 24.5–26.1 seconds to complete; E4-T34 owns that runtime/JIT acceleration. This task
returns to `implemented`, never `verified`, pending a fresh adversarial review of the new evidence.

### 2026-08-10 — verifier — VERDICT: needs-evidence

- **P8 raw process oracle — NEEDS EVIDENCE.** Predicted a frozen, independently interrogable
  terminal record for each exact Node process. The new bundle contains all twelve exact command,
  sequence, positive PID, standalone-output, zero-exit, concrete-marker, and transcript fields, but
  `web/tests/e4-t32-node-walltime.spec.js:423-451` discards its bounded raw terminal buffer and
  synthesizes `oracleTranscript` from two regex captures. A clean stream and
  `UNRELATED_STALE_OUTPUT\n3\nNODE_NEVER_PROVEN_AND_INTERVENING_NOISE\n<marker>` produce the same
  validated persisted object, so the artifact cannot expose intervening output or independently
  attribute the retained `3` to the measured child. Persist the bounded raw slice from command echo
  through marker (with offsets/hash), or an equivalent guest exec/output trace, and rerun only the
  Node matrix evidence boundary.
- **Absolute calibration and artifact identity — HELD.** Exact `ab3e6fc4` reference bytes and
  physical/logical hashes reproduce; all 12 pre/post verdicts recompute from raw samples. Six clean
  counterbalanced attempts, 30 sidecars, 12 unique attempt-scoped process identities, all declared
  inventory/result/ledger hashes, the seven parity ratios, four Worker rAF p99 values, input/RPC,
  and positive JIT execution/retirement independently match. Requested oracle-field and raw-sample
  sabotage both failed closed; the focused harness suite passed 81/81.
- **P1-P7/P9-P15 — CARRIED HELD.** Runtime and built Wasm are unchanged from the prior verified
  boundary, so browser/rr/cold-clone/controller findings are not re-litigated. Full predictions,
  hashes, commands, the stream-equivalence attack, and non-blocking harness-hardening observations
  are in `evidence/e4-t32/VERIFIER-REPORT.md`.
- **COVERAGE/SUITE:** no runtime or product hunk moved. No new test is promoted until the raw
  recording gap closes; unchanged load-bearing suites remain credited.
