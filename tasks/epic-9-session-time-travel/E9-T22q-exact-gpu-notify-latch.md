---
id: E9-T22q
epic: 9
title: Preserve virtio-GPU notification latches in exact checkpoints
priority: 524.9220297
status: implemented
depends_on: [E9-T22n]
estimate: S
risk: high
capstone: false
---

## Goal

Make a restored exact GPU checkpoint resume the same queue-service schedule as
the recorded machine. A published descriptor with no pending QueueNotify must
stay unclaimed until the guest really notifies it.

## Boundary

The virtio-GPU exact result-checkpoint codec, its logical-state witness and
bounded replay proof. Keep ordinary 2D reconnect's wake-up policy, frozen
Omarchy assets, guest clock, 50M checkpoint cadence, workloads and performance
budgets unchanged. Existing checkpoints that omit the latches must not silently
claim exact replay fidelity.

## Acceptance criteria

- [ ] Persist and validate both control and cursor notification latches in the
  exact result checkpoint, restore them atomically, and bind their values into
  the logical state digest. Reject unsupported older exact GPU checkpoint
  versions explicitly rather than inventing a latch value.
- [ ] In deterministic native tests, a published but unnotified control
  descriptor remains unclaimed after restore; a notified control descriptor
  advances, and the equivalent cursor cases hold. Malformed latch fields fail
  without partial state changes. Ordinary 2D reconnect still rearms both queues.
- [ ] Prove built-WASM browser record/replay parity across a GPU checkpoint
  with an unnotified published descriptor, including the next witness and zero
  live replay egress. A fresh Daybreak verifier attacks the new format and one
  bounded notification race.

## Deterministic acceptance

`make verify-E9-T22q` at the frozen exact head.

## Adversarial verification

Try a control descriptor published without QueueNotify, an equivalent cursor
descriptor, both notifications just before capture, a corrupt latch byte, and
an older checkpoint with no latch bytes. Compare queue shadows and logical
digests at the first resumed witness; a merely matching initial checkpoint is
insufficient.

## Verification log

### 2026-10-26 — worker — implemented, awaiting fresh Daybreak verdict

At clean exact implementation head `14d91c8a497b30dc55d603c3e12a44c1ec412be2`,
`E9_OUT=target/evidence/e9-t22q-14d91c8a4 make verify-E9-T22q` passed:
format, strict affected Clippy, 52 native GPU tests, wasm32 build, reproducible
`web/dist`, built-Chrome record/replay, independent saved-byte oracle, and the
demo. Exact result checkpoint v3 records and validates both QueueNotify latches;
the logical GPU witness binds them, v2 exact checkpoints fail explicitly, and
ordinary 2D reconnect retains its re-arm policy. Native tests cover notified
and unnotified control/cursor queues plus malformed and legacy formats.

The browser recorded a published control descriptor at PC `0x8020016e`
before QueueNotify, with queue shadow `last_avail=used=0` and latches `[0,0]`.
The restored replay reached the next witness at transition `9484`, retired
`9464`, sequence `22`, digest
`a45145873d52c709bfd1105c41553e728815b78615982b2909da0c5ca5bf6ff9`,
equal to the original. Browser console/HTTP errors, external replay requests,
and replay sockets were zero. The byte oracle accepted four frames, 32 GPU
events, one failed completion, and three bodies. The demo reported `127 passed,
0 failed`, no page/HTTP errors, and mobile width equal to scroll width (388 px).

Evidence under `target/evidence/e9-t22q-14d91c8a4`: `browser/report.json`
SHA-256 `73b4ebcdff1dc366ef8654625c8af2fc106555c6d9bc1846e2b9af6c209c84a6`,
`browser/browser-trace.zip` SHA-256
`712e2e73b81f9258c5ab12268443d23f8ed81fba2711421e58815c8307c1dac5`,
`byte-oracle.log` SHA-256
`ee360915d5cf41de25cef195bce7aac98b0a6d9a70074f52fa177d35114173e8`,
and `demo/report.json` SHA-256
`8ce0db3fc1d063fe09d791a2491ef873981772a2b8f7d921c9d648bca7a6bfa3`.
The independent clean-checkout run at the same implementation head, with a
scrubbed environment and shared Git objects, passed all seven acceptance
stages after allowing the pinned Emscripten SDK to update its host cache.
Its retained `cold-checkout/browser-report.json` SHA-256 is
`68782ce7c22da57d94cce8d3d941695280e618db43db46c1a0ddd821ff454e97`,
`cold-checkout/browser-independent-bytes.json` SHA-256 is
`a710a41d202badb04cd731e85305e4a4542a261ddd57e18a458b80c8b2dc4b39`,
and `cold-checkout/demo-report.json` SHA-256 is
`5555da52790b1f4b7f8f24c16fb2237a1657911d52c94800cb5f81c75819bfd0`.
The earlier clean-checkout native failure did not recur on a bounded diagnostic
rerun; its cause was not captured. The later web-build failure was the sandbox
denying the pinned SDK's cache write and passed under normal host permissions.

`make ci` stopped at pre-existing no-default-features `dead_code` warnings in
untouched `session_clock.rs` and `session_devices.rs` (log SHA-256
`996df3a642b1a78f54dc45ac56e4e9f8f4bcf9f1a71a28eed32c58ac4cd5602f`).
The remaining prescribed global gates passed directly with `make test wasm
features test-riscv riscv-tests-suite determinism perf-smoke` (log SHA-256
`787c804b9d5a08d61fc39bd550fcd22cb488cf191331d70748f70a7deff96a55`).
The fresh Daybreak critic has independently exercised the before/between/after
two-queue notification race; its verdict and coverage audit remain separate.

### 2026-10-26 — worker — reproduced before implementation

The authenticated E9-T22c cold-395 checkpoint at 19.8B has the same initial
witness as its original run. At the next 19.85B witness, replay's RAM and every
serialized component except `VIRTIO_GPU` match the independently reconstructed
cold-396 state. Original control queue shadow is `last_avail=452, used=452`;
replay is `last_avail=453, used=452`, with an extra pending
`CMD_RESOURCE_FLUSH` and no additional recorded receipt. The original digest is
`7967c3dde55a71e77ad05461c6a1b038286fd44fc89dfd909d12dea876974002`;
replay observes `5b2ea2cf90b5b05a3ef21fce4c48e9c37390f7c2bccc85678fd9d47ffd5d989c`.
See `target/evidence/e9-t22o-state-diff.json` (SHA-256
`b272b4c2ebaf82e28b68c4dd8e1146069a9f14b881da8e2e66ca003ddf3cc7f5`)
and the divergent browser report (SHA-256
`bebdbf1cf874a794cfc65f5656bdf042d8decf88e73a8fc3596b1f835492c41d`).
Fresh Daybreak inspection traced the extra dequeue to
`GpuState::commit_gpu_checkpoint` calling `snapshot::apply`, which sets both
`kicked` flags true; the exact checkpoint does not serialize their recorded
values. Browser console errors and external egress were zero.
