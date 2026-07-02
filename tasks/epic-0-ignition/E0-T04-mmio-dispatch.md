---
id: E0-T04
epic: 0
title: MMIO dispatch layer routing bus windows to memory-mapped devices
priority: 4
status: in-progress
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
