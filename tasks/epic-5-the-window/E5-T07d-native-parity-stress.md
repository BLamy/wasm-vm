---
id: E5-T07d
epic: 5
title: Native fbcon parity and first-light stress proof
priority: 507.4
status: verified
depends_on: [E5-T07c]
estimate: S
risk: high
capstone: false
---

## Goal

Close the first-light integration with a native null-sink parity check and bounded scroll, VT, and
reload stress against the browser trace fixture.

## Boundary

This slice owns comparative evidence and stress hardening for the already-integrated path. It does
not add new display features or broaden the acceptance to independent machines or WebKit.

## Deliverables

- A native headless capture using the identical kernel/rootfs and the null sink.
- A normalized native/browser probe comparison plus the final resource/queue health report.
- A bounded stress verifier for rapid fbcon scroll, VT switching, and tab-reload/re-probe cleanup.

## Acceptance criteria

- Native and browser traces agree on probe order and framebuffer dimensions modulo timestamps and
  explicitly documented host-only fields.
- One million-byte console scroll and 100 VT switches complete without a controlq deadlock, resource
  leak, row corruption, or duplicate callback.
- A reload after an interrupted run starts from a clean device state and the native null sink still
  reaches the same terminal probe boundary.

## Verification command

`make verify-E5-T07d`

## Adversarial verification

Repeat the stress harness with independent seeds and a forced queue delay at each flush. Compare the
final screenshot/readback against the reference renderer and reject any unexplained divergence from
the T07a fixture.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- P1 native/browser probe parity — HELD. Predicted the native null-sink boot would preserve the
  T07a terminal controlq order and 1280x800 resource dimensions; `native-probe-gpu.log:1-17`
  contains 15 records, `dropped=0`, contiguous used-ring progress, and an exact normalized match
  to `tests/fixtures/gpu-probe.log`. The Chromium stress proof reports the same 1280x800 surface,
  all Linux virtio-gpu/DRM/fbcon markers, and `sourceDistParity.equal=true`.
- P2 scroll/VT stress — HELD. Predicted the native null sink would complete the one-million-byte
  `/dev/tty0` write and 100-switch loop with a clean shutdown; the recorded native transcript has
  `1000000 bytes`, `E5T07D_SCROLL_OK`, `E5T07D_VT_OK`, and `reboot: Power down`, while guest
  evidence records a positive retired count and `outcome=Exited(0)`. Chromium independently held
  the reference buffer equal to Canvas2D (`mismatchBytes=0`), with 707 callbacks, 707 successful
  presents, no drops, stable dimensions, preserved pixels outside every observed damage rectangle,
  contiguous sampled callback sequence, and 216/216 scheduled input bytes.
- P3 queue-delay attack and reload cleanup — HELD. A second Chromium run with seed `23` and a
  forced 1 ms delay at each present also held readback equality (`mismatchBytes=0`, 690 callbacks,
  no browser errors). The manual seed-31 run was interrupted after input call 1 and reloaded; the
  fresh controller reached all three boot markers with `inputCalls=0`, `inputBytes=0`, and 21 new
  framebuffer callbacks.
- COVERAGE — HELD. The exact implementation head was
  `742889bb5657552e0818b267d0ce7e0c4dd5d423`; the verifier exercised the native parity/stress
  process, the browser route, delayed second seed, and interrupted reload route. Independent
  machines, WebKit, and host rr are intentionally excluded by this task's boundary and policy.
- SUITE: the permanent artifact is `make verify-E5-T07d`, which runs the scoped Rust gates,
  release CLI build, Chromium-only verifier, source/dist parity, screenshot, guest evidence, and
  normalized native trace comparison.

Commands: `make verify-E5-T07d`

Evidence: `evidence/e5-t07d/native-parity-stress.json` (SHA-256
`9870c73e4958e4477533165f5fb7a8917dd264d1e0f0a70e09a571c773d01d9b`),
`evidence/e5-t07d/native-probe-gpu.log` (SHA-256
`06eff203f10b1583a4c4450a6e20ff56792a25b70402a22ebeaf03f62d5f4e0b`), and
`evidence/e5-t07d/tty0-stress.png` (SHA-256
`e57be9f2d64ba60aa37d85cbbc912aed6615d4083544456eaca89e46babf3542`).

The recording demonstrates that the checked-in kernel/initramfs reaches the same native terminal
probe boundary, survives the bounded tty0/VT workload, preserves the browser framebuffer against
an independent model under normal and delayed presentation, and reconstructs a clean device after
an interrupted tab reload.
