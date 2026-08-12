# E4-T34 JIT retrospective: what worked, what failed, and the next bets

Date: 2026-08-12
Scope: E4-T29 through E4-T34 browser JIT and the E4-T32 whole-machine worker
Decision: keep the short-block JIT experiment out of the production merge until a fresh,
self-only Node run clears the same acceptance bar as the WebVM comparison.

## Executive summary

We solved the wrong problem first, then solved an important adjacent problem well.

The whole-machine Worker made the demo responsive and prevented renderer contention from making the
terminal feel hung. The measured E4-T32 result was strong: roughly **18.66 ms rAF p99**, **113.9 ms
input**, and **511 ms RPC**, with clean worker overhead of about **+1.68% first output** and **+1.57%
completion**. That is a real product win and is already on the main line.

The JIT work did not make restored Node run at WebVM speed. The recorded warm browser Node result was
about **21–26 seconds** in the earlier T32 baseline; cold runs were about **83–92 seconds**. Later
short-block/JALR experiments produced runs as slow as roughly **111 seconds** for the same 2M-iteration
checksum fixture. The off/off diagnostic recovered about **9.91M retired guest instructions per
second** in its hot phase, but still took about 111 seconds for approximately 1.104B retired
instructions. The accepted WebVM comparison was about **19.77 seconds**, so that diagnostic was not
close enough to publish as a speed win.

The honest conclusion is:

- **Worker responsiveness: better and shipped.**
- **Warm Node startup: the T32 baseline remains the reference; the JIT branch is not better.**
- **WebVM parity: not proven and not claimed.**
- **JIT code: experimental/stashed, with the follow-up tickets below.**

## What worked

### 1. The whole-machine Worker solved user-visible contention

Moving the complete Linux machine—not only a few execution calls—onto the dedicated Worker made
input, RPC, and paint scheduling independent of the guest's long interpreter/JIT slices. The
cooperative boundary, heartbeat, raw terminal oracle, and foreground browser policy gave us a
defensible responsiveness measurement instead of an eyeballed “it feels smoother” claim.

This is the part to preserve in production. It is independent of whether the guest executes via the
interpreter, predecoded cache, or a future compiled tier.

### 2. The snapshot removed boot/install work

The Node-preinstalled image and warm restore path removed Linux boot and package-install cost. The
remaining benchmark is mostly genuine `/usr/bin/node` execution, which is why the warm baseline is
the correct target for JIT work. A background prime can warm a subsequent command, but it is not a
substitute for measuring the first command and must never be hidden inside the published timing.

### 3. Correctness and lifecycle hardening were real progress

The JIT branch accumulated useful safety work even when its throughput target was missed:

- exact retire/block/fuel accounting at compiled boundaries;
- precise fault and interrupt handoff back to the interpreter;
- SMC, FENCE.I, SFENCE.VMA, PMP, and privilege invalidation paths;
- bounded browser module/externref ownership and adversarial eviction tests;
- cached-load/store authority checks and reservation safety;
- raw terminal/checksum oracles that reject spoofed “Node finished” output.

Those are reusable foundations. They are not evidence that the compiled tier is fast enough.

## What failed

### 1. The JIT did not reduce the host-boundary rate enough

The dominant shape was many short compiled calls rather than a small number of long traces. The
observed hot phase was roughly **2.45 logical blocks per engine call** and about **13–15 retired
instructions per compiled call**. The original concern was around five guest instructions per
compiled dispatch; later measurements show that the boundary is still far too frequent.

For a 20-second-class result on this fixture, the system needs an order-of-magnitude fewer engine
entries or a much cheaper entry path. Lowering a threshold, increasing a quantum, or adding one more
telemetry counter cannot supply that missing fusion.

### 2. Same-page repacking amplified compile work invisibly

The replacement path recompiles the retained union of a page. The public `installs` counter mostly
counts new members, not every function translated in the retained union. A run can therefore show
moderate installs while synchronously recompiling many old functions. “Retranslations=0” was not
enough to rule out compile pressure: repack work was hidden in submitted-member count and pause time.

The safe policy is to keep progressive repacking off until a benchmark proves that its extra compile
work buys a large, stable increase in logical-blocks-per-engine-call.

### 3. Dynamic JALR wrappers were expensive on the hot path

The first design used per-source wrapper modules and a Wasm-to-JS authority callback. Even after the
inline PIC/EXEC-TLB work removed the callback, armed attempts still paid shared-memory guards,
telemetry, touch-log work, and an indirect call. Retargeting a polymorphic return site also tore
down and retrained a dispatcher after only a few observations. That is a poor fit for V8-style return
addresses and explains the high install/live ratio in the diagnostics.

The next design must keep target validation in generated code, but it also needs hysteresis or a
small multi-target return PIC. A one-entry monomorphic cache is not enough for this workload.

### 4. Cross-module chaining added cost before it added coverage

The first cross-module implementation emitted touch bookkeeping at every linked-function prologue,
including calls that never took an inter-module edge. At the same time, eligibility was restricted
to memory-free blocks, while Node's useful direct-control-flow regions are frequently memory-heavy
and cross-page. The result was overhead on nearly every invocation with too few useful links.

The corrected design makes touches edge-local and allows the already-audited SharedReadTlb-safe
memory blocks. It is still an experiment, not a production claim.

### 5. Cache/module residency was allowed to become the workload

The experimental Browser path reached a live module cap of roughly 1024 while compiling many small
modules. V8 Module/Instance/code footprint was not initially charged with the same fidelity as guest
metadata. A large cap can hide churn for longer; it does not make each module boundary free.

The next measurements must report submitted members, compile pause time, module count, evictions,
retranslations, logical blocks per engine call, and JIT retired share together. Looking only at
`installs` or `moduleCount` is insufficient.

## Root cause tree

```text
Warm Node is still slow
├── Too many engine entries
│   ├── page-local traces stop at cross-page/direct edges
│   ├── memory-heavy blocks excluded from early cross-module links
│   └── dynamic return sites are polymorphic
├── Each entry is expensive
│   ├── Wasm state handoff and indirect table call
│   ├── JALR guards/telemetry/touch logging
│   └── virtio/device boundaries remain intentionally precise
└── Compilation competes with execution
    ├── progressive same-page union repacks
    ├── many small Module/Instance objects
    └── live-cap eviction/retranslation pressure
```

The Worker and snapshot reduce host scheduling and boot costs. They do not change this tree's
execution-boundary terms, which is why the UI improved while Node remained slow.

## Next tickets

These are intentionally small, falsifiable tickets. Each one must use the exact checksum fixture,
the same restored image, one changed policy, and a fresh Wasm/runtime digest. No ticket may claim a
speedup from a synthetic ALU loop alone.

| Ticket | Change | Acceptance gate |
|---|---|---|
| **E4-T35** | Edge-local static links | SharedReadTlb-safe two-module load/store, cold-target refund, precise fault, SMC unlink; short Node run must reach **≥5 logical blocks/engine call** before a full run is allowed. |
| **E4-T36** | Guarded cross-page direct links | Authoritative VA+PA publication, generated EXEC-TLB validation, exact invalidation; target **≥7.3 logical blocks/engine call** and no checksum/retire drift. |
| **E4-T37** | JALR return PIC | Keep validation in Wasm; add bounded two/four-target hysteresis; report attempts/hits/refusals/retargets and require no install storm over a fresh Node run. |
| **E4-T38** | Residency/repack policy | Compare repack-off, cap-256, and cap-1024 on identical bytes; publish submitted-members, compile-pause, module, eviction, and retranslation deltas. Keep the policy with lower wall time and lower churn. |
| **E4-T39** | Entry-path cost ledger | Instrument state-copy, indirect-call, authority, memory-split, and device-boundary time separately; acceptance requires a measured dominant term and a follow-up ticket, not threshold tuning by guesswork. |

Stop conditions for every ticket: checksum mismatch, retired-count drift, a precise-fault or timer
divergence, live-module growth without a bounded plateau, or a short-run logical/engine ratio below
the ticket's gate. If a ticket fails, keep its evidence and close it as refuted rather than stacking
another optimization on top of an unmeasured regression.

## Production decision

The whole-machine Worker, warm snapshot path, homepage benchmark surface, and provider-selection UI
are product work. The short-block/JALR JIT branch is performance research. We should merge the
product work and this retrospective, leave the experimental JIT changes out of the production
merge, and reopen E4-T34 only when a self-only run demonstrates a real improvement over the T32 warm
baseline and approaches the WebVM comparison under the same declared fixture.
