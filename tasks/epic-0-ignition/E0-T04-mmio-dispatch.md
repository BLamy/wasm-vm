---
id: E0-T04
epic: 0
title: MMIO dispatch layer routing bus windows to memory-mapped devices
priority: 4
status: verified
depends_on: [E0-T03]
estimate: S
capstone: false
---

## Goal
A `SystemBus` that implements `Bus` by routing each access either to guest RAM or to a
registered `MmioDevice` by physical address window, with unmapped holes returning
`BusFault::Access` — the single seam through which every future device (UART, CLINT, PLIC,
virtio-mmio) attaches.

## Context
Architectural bet #3 is "virtio everywhere"; that only works if device attachment is a
one-line registration. The stub console (E0-T12) is the first client. The hot path
(RAM access during fetch/execute) must not regress measurably — this dispatch sits under
every single instruction.

## Deliverables
- `crates/core/src/mmio.rs`: `MmioDevice` trait with width-explicit
  `read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault>` / `write(...)`;
  `Width` enum {B1, B2, B4, B8}.
- `SystemBus { ram, devices: Vec<(Range<u64>, Box<dyn MmioDevice>)> }` with
  `attach(base, len, dev)` that rejects overlapping windows (including overlap with the
  DRAM range) at registration time with a typed error.
- A `RecordingDevice` test double capturing (offset, width, value) sequences.
- Unit tests native + `wasm-bindgen-test` mirror.

## Acceptance criteria
- [ ] Accesses inside a window reach the device with the correct *offset* (not absolute
      address), width, and value; accesses in `DRAM_BASE..end` reach RAM unchanged.
- [ ] Access to an unmapped hole (e.g. `0x2000_0000`) returns `Access` at every width.
- [ ] An access straddling a window edge (e.g. `load64` at `window_end - 4`) returns
      `Access` and does not partially invoke the device.
- [ ] `attach` returns an error for windows overlapping RAM or another device.
- [ ] Suite passes natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Attach a device at `DRAM_BASE - 4` with length 8 — registration must fail; if it
succeeds, demonstrate the resulting aliasing and refute. (2) Issue a `load64` whose first
byte is the last byte of a device window — confirm via `RecordingDevice` that the device
saw *zero* calls. (3) Register 100 devices and measure RAM-path throughput vs. bare `Ram`
with a quick criterion micro-bench — >10% regression on the RAM path refutes the hot-path
claim. (4) Check width forwarding: a `store16` must arrive as B2, not two B1 calls.
(5) Attempt zero-length windows and `base + len` overflow (`base = u64::MAX - 2, len = 8`)
— panics refute.

## Verification log

### 2026-07-02 — worker claim — branch task/e0-t04-mmio-dispatch (stacked on e0-t03)
Deliverables: `crates/core/src/mmio.rs` — MmioDevice trait (width-explicit read/write,
Width{B1,B2,B4,B8}), SystemBus with attach() rejecting zero-length windows
(ZeroLength), end-overflow (AddressOverflow, checked_add; a window containing byte
u64::MAX is unattachable by design, documented), and overlap with RAM or devices
(Overlap, u128 math exact even for E0-T03's past-u64::MAX RAM tail); RecordingDevice
test double (Rc<RefCell<RecordingLog>> handle, always compiled so wasm tests and
verifiers share it); 12 native unit tests + 5 wasm-bindgen-test mirrors; criterion
bench (benches/mmio_dispatch.rs) + paired perf test (tests/hot_path.rs).
ROUTING POLICY (documented in module doc): full containment or no device invocation
(straddles fault Access with ZERO device calls — RecordingDevice-asserted); fault
precedence unchanged from E0-T03 (range then alignment); device read results masked to
width; RAM-first dispatch — Ram's own checked bounds double as the routing test
(Err(Access) ⇔ not RAM), device scan is a #[cold] split-borrow free fn taking only
&mut [Window] so the optimizer can prove ram survives fallback calls.
HOT-PATH EVIDENCE (adversarial angle 3) — full disclosure of the measurement journey:
sequential criterion runs on this host swing 3-6x between runs (unusable at ±10%); a
naive paired 2-arm harness reported +76.7% which was LLVM store-forwarding the bare-Ram
workload into nothing (fixed with per-iteration black_box of the bus ref); the fixed
2-arm harness then reported +24.5% IDENTICAL (±0.1%) across three dispatch
implementations — that constancy exposed fixed-order position bias (confirmed by a
bare-vs-bare control arm reading 0.91 and arm medians increasing monotonically in
measurement order). Final harness (tests/hot_path.rs): 4 arms (bare, bare-control,
bus0, bus100), 301 rotation-debiased interleaved rounds, control-gated. Result:
control 1.0013/0.9980 (sub-1% resolution proven), instruction-shaped workload bus100 =
1.084 (+8.4%, within the 10% budget), pure-streaming bus100 = 1.015 (+1.5%), and
bus0 ≈ bus100 (registered devices add nothing to RAM traffic, as designed).
Reproduce: cargo test --release -p wasm-vm-core --test hot_path -- --ignored --nocapture
(the test hard-fails if the control arm shows the host cannot resolve the budget).
Cross-task perf touch: #[inline]/(always) attributes added to E0-T03's Ram accessors
(no semantic change; full E0-T03 suite incl. fuzz re-run green).
Gates: fmt/clippy(-D warnings)/test --workspace/no_std wasm32/wasm-pack test --node
(11 wasm tests: 5 mmio + 6 e0-t03)/miri green — see PR for CI run.
rr: SKIPPED locally (macOS/no PMU per AGENTS.md); deterministic tests + miri + CI Linux
are the evidence layer.

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: verified
- P1 ram.rs cross-task touch — HELD. Predicted attribute-only delta + E0-T03 suites green; observed exactly 4 added #[inline]/(always) lines, zero semantic hunks, and in the cold clone the full E0-T03 suite green: 9 ram unit tests, 8/8 verifier_fuzz (+1 explicitly-ignored alloc test), 6 wasm ram_bus tests.
- P2 RAM-overlap aliasing — HELD. Predicted Err(Overlap) for DRAM_BASE-4/len 8, window-inside-RAM, window==RAM-extent, window-ending-at-RAM-last; Ok for adjacent-before/after; observed all six (verifier_e0t04::p2_ram_overlap_attacks). Zero-size RAM: window over DRAM range attaches and routes. Ram::with_base(u64::MAX-0xFFF, 0x2000) — RAM tail past u64::MAX as u128 — still rejects overlapping attaches, u128 math exact.
- P3 straddle silence — HELD. Predicted Access + zero device calls for load64/load16/store64 whose first byte is the window's last byte; observed 0 reads + 0 writes in RecordingLog. Adjacent-windows case (not in worker's tests): 8-aligned load64/store64 spanning two fully-mapped touching windows → Access, BOTH logs empty.
- P4 hot-path budget — HELD. (a) Worker harness as-is, 3 runs: instr control 1.0007/0.9993/1.0000 (sub-1% resolution confirmed), instr bus100 1.0874/1.0792/1.0878 — ≤1.10 every run, matching the claimed 1.084; streaming bus100 1.0138/1.0158/1.0157 ≈ claimed 1.015; bus0 ≈ bus100 as claimed. (b) Fixed-order copy (rotation removed): position-bias artifact NOT reproduced — control read 1.0014/0.9994 even under 6-way `yes` load; the worker's 0.91 diagnosis is plausible (host-state-dependent; 20% absolute swings observed BETWEEN process invocations) but unconfirmed today. Not a refutation: rotation is harmless insurance and the control GATE — the actual safety mechanism — is verified working. (c) Workload audit: instr shape is bus-heavier than a real interpreter, i.e. conservative; black_box placement symmetric. Skeptic workloads: pure-load64 bus100 = 0.952 (faster than bare), dependent-address chain = 0.995/1.006 — the worker's own gated workload is the WORST case of everything measured; nothing tuned to hide overhead. (d) Criterion bench confirmed unresolving: run-to-run change estimate [-1.0%,+45.7%] p=0.09 — cannot resolve ±10% on this host, as disclosed.
- P5 width forwarding — HELD. One call per op at exact width for all 8 Bus ops with correct (offset,width,value); load8 of all-ones device = 0xFF. Mask-removal sabotage: no test goes red — analyzed as an EQUIVALENT mutant: `v as $ty` in sysbus_load! truncates identically, so the observable no-stray-bits behavior is enforced and tested regardless; `& width.mask()` is redundant defense-in-depth on a private path. Note only, no demand.
- P6 zero-length / overflow attach — HELD. Typed errors, no panics: ZeroLength; AddressOverflow for base=u64::MAX-2 len=8, for base+len==2^64 exactly (matches the documented design), for base=u64::MAX len=1; len=u64::MAX → Overlap with RAM present, Ok over empty RAM and routable to its last byte, with Misaligned precedence intact at the u64::MAX edge.
- rr — SKIPPED loudly: macOS/Apple Silicon, rr unsupported per AGENTS.md. Mitigation: deterministic tests + miri + green Linux CI 28593201900.
- miri — HELD (scoped). Full-crate run exceeds a 10-min window on this host; decision-relevant targets green: all 12 mmio unit tests and all 9 verifier attack tests UB-clean — every Rc/RefCell RecordingDevice path executes under both.
- COVERAGE: attach/overlap hunks — killed (M2 RAM-overlap-removed, M4 wrapping_add → tests red); contains/routing hunks — killed (M1 first-byte-only containment → straddle test red); store width path — killed (M3 store16→2×B1 → two tests red); mask expression — surviving but equivalent (P5), waived; ram.rs #[inline] hunks — waived (attributes); Cargo.toml/lib.rs/Cargo.lock — waived (build plumbing); bench + hot_path harness — executed in P4. All mutations reverted; clone clean.
- MOCK/HONESTY: RecordingDevice is a declared test double, compiled unconditionally — no cfg(test) semantics leak; no golden values computed by code under test. Claimed numbers reproduce in spirit (control 1.0013/0.9980 vs verifier 1.0007–1.0000; +8.4% vs +7.9–8.8%; +1.5% vs +1.4–1.6%). Commit hygiene: 64d539a−c2cbbbe is tasks-only; CI 28593201900 exists, headSha=c2cbbbe, 7/7 jobs green, test-job log shows all 12 mmio tests running. Perf-journey disclosure audited: criterion-unusable and store-forwarding claims verified; position-bias story internally consistent but not reproducible today. ONE stale artifact: hot_path.rs module doc still attributed ~25% streaming cost to #[cold] reachability — misleading doc, behavior unaffected — demand: fix in follow-up commit.
- NOVEL: (1) adjacent-windows aligned straddle — Access, zero calls on both devices; (2) device-window→RAM boundary straddle at DRAM_BASE-4 — Access, zero device calls, RAM head byte-identical after the faulting store; (3) window at base 0xFFFF_FFFF_0000_0000 — offsets stay window-relative at extreme bases, and device-chosen faults (incl. Misaligned from a write) propagate verbatim; (4) [0, u64::MAX) window over empty RAM — routable to last byte with fault precedence intact. All held.
- SUITE: promote crates/core/tests/verifier_e0t04.rs (9 deterministic tests, miri-clean, incl. two behaviors no worker test covers). Discard hot_path_fixed.rs (bias rig, host-state-dependent) and hot_path_skeptic.rs (workloads read ≤1.0; kept in scratch for E0-T24 reference). Worker's 12 native + 5 wasm tests: keep — mutation-kill evidence proves they bite.
Commands: cold clone (env scrubbed); fmt/clippy/test --workspace; cargo test --test verifier_e0t04; hot_path x3 (+1 under 6-way load); hot_path_fixed x2 (+1 under load); hot_path_skeptic x2; criterion bench x2; 5 mutations (each reverted); wasm-pack test --node (11 tests by name); miri (mmio lib + verifier_e0t04); gh run view 28593201900 (+ test-job log grep).

### 2026-07-02 — post-verdict actions (worker)
Applied the verifier's demand: hot_path.rs module doc rewritten — the ~25% streaming
number is now correctly attributed to fixed-order measurement bias (refuted by both
parties' debiased runs), not #[cold] reachability. Promoted verifier_e0t04.rs verbatim
into crates/core/tests/. Gates re-earned: fmt + clippy -D warnings (exit 0 verified) +
cargo test (24 unit + 9 verifier + 8 fuzz) green.
