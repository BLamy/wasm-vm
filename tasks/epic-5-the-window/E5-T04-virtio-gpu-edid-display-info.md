---
id: E5-T04
epic: 5
title: EDID blocks and display-info config events (hotplug plumbing)
priority: 504
status: verified
depends_on: [E5-T03c]
estimate: S
risk: high
capstone: false
---

## Goal
The device advertises `VIRTIO_GPU_F_EDID`, answers `VIRTIO_GPU_CMD_GET_EDID` with a valid
128-byte EDID block whose preferred detailed timing matches the current host canvas size,
and can raise `VIRTIO_GPU_EVENT_DISPLAY` through `events_read` + config-change interrupt —
the mechanism display resize (T22) and multi-display (T27) will ride on.

## Context
Linux's virtio-gpu driver reads EDID when the feature bit is offered and uses it to build
the DRM connector's mode list; without it the guest falls back to the bare
GET_DISPLAY_INFO rect plus stock VESA modes, and compositors may pick 1024x768. The EDID
must have: header `00 FF..FF 00`, a fake vendor (e.g. PNP id "WVM"), one detailed timing
descriptor for the native mode, range-limits descriptor, and a correct checksum byte
(sum of all 128 bytes ≡ 0 mod 256). Config events: device sets bit 0 (EVENT_DISPLAY) in
`events_read` and asserts the config-change interrupt; guest acknowledges by writing the
bit to `events_clear`, then re-issues GET_DISPLAY_INFO/GET_EDID. Reference: virtio v1.2
§5.7.4–5.7.6.10; EDID 1.4 spec; `drm_edid.c`.

## Deliverables
- `gpu/edid.rs`: EDID 1.4 generator `edid_for(width, height, refresh) -> [u8; 128]` with
  DTD pixel-clock math and checksum; unit-tested against `edid-decode` output fixtures.
- `GET_EDID` handler (scanout-indexed, `ERR_INVALID_SCANOUT_ID` for out-of-range).
- `VirtioGpu::set_display(width, height)` host API: updates pmode 0 + regenerated EDID,
  sets EVENT_DISPLAY, raises config IRQ; `events_clear` write-1-to-clear semantics.
- Feature bit `VIRTIO_GPU_F_EDID` offered and honored (no GET_EDID service if the guest
  did not negotiate it — respond ERR_UNSPEC).

## Acceptance criteria
- [ ] Generated EDID for 1280x800@60 passes `edid-decode` with zero warnings (fixture
      checked in; regeneration compared byte-for-byte in a test).
- [ ] Checksum byte is valid for every size in a sweep of 50 (w,h) pairs including odd
      widths and 3840x2160.
- [ ] `set_display()` flips `events_read` bit 0 and raises exactly one config interrupt;
      a second call before `events_clear` does not lose the event.
- [ ] `events_clear` write clears only the written bits.
- [ ] Native + wasm32 tests green.

## Adversarial verification
Refute by feeding the EDID to real consumers: run `edid-decode --check` on 20 generated
blocks (CI fixture) — any checksum or DTD error refutes. In the guest (once T07 lands),
`cat /sys/class/drm/card0-Virtual-1/edid | edid-decode` must agree with the host-side
size. Race the event path: call `set_display()` 1000 times from the host thread while a
test guest polls/clears — prove no lost final state (last size always readable) and no
spurious interrupt storm (IRQ count ≤ set_display count). A guest that negotiates
without F_EDID must never see GET_EDID succeed.

## Verification log
### 2026-09-04 — worker — implementation submitted

- Commit: `a2742e9bfa93dc67cc68a5a8b3204bfe8fd450b4` (`feat(e5-t04): add EDID display hotplug plumbing`).
- Commands: `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_BUILD_RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS make verify-E5-T04`; a Docker `debian:bookworm-slim` run installing `edid-decode` and checking 20 generated blocks; `git diff --check`.
- Evidence: [`evidence/e5-t04/edid-display-proof-2026-09-04.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t04/edid-display-proof-2026-09-04.json), SHA-256 `1e2c875d1fcdc93d69917b353c521eb6b8120e9b0c78b91877787506606110a4`; transcript [`evidence/e5-t04/edid-display-proof-2026-09-04.txt`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t04/edid-display-proof-2026-09-04.txt), SHA-256 `26030ed70aaec6576d030f196335a3264b8bdf74d184bc6af34650bd2832db9f`; built-page Chromium screenshot [`evidence/e5-t04/roadmap-browser.png`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t04/roadmap-browser.png), SHA-256 `771b232f0918ec2e1c821b0229253a95e9222fce1ab6732882c399b81c849a6e`.
- Claim: the exact-head run proves byte-stable EDID 1.4 generation and checksum-valid preferred timings over 50 sizes, real-consumer conformity for 20 blocks including odd and 3840x2160 modes, negotiated scanout-indexed GET_EDID, dynamic GET_DISPLAY_INFO pmode data, W1C event bits, and 1,000 resize/transport-sync/ack/clear cycles retaining the final display without an IRQ storm. Independent machines, WebKit, and host rr are waived per the user's instruction and the repository's current evidence policy.

### 2026-09-04 — verifier — VERDICT: verified

- P1 EDID structure and preferred timing — HELD. Predicted the regenerated 128-byte 1280x800@60 block would be byte-identical to the checked-in fixture, checksum-valid, and accepted by an independent EDID consumer. Observed SHA-256 `46db74fa6b83d3a2fef9ae062be195860d220f4175a2f16b988d871c6833593c`, exact 1280x800 preferred timing, and `EDID conformity: PASS` with no warnings or failures in the transcript.
- P2 dimension/checksum coverage — HELD. Predicted odd widths and the 3840x2160 boundary would remain representable and checksum-valid. Observed the native 50-size sweep and the independent 20-block decoder sweep both pass, including `1365x768`, `1366x769`, `1921x1081`, `3840x2160`, and `3841x2161`.
- P3 negotiation and hotplug semantics — HELD. Predicted a guest without F_EDID could not obtain an EDID, an invalid scanout would return `RESP_ERR_INVALID_SCANOUT_ID`, and a resize burst would preserve the last mode while coalescing notifications until W1C. Observed the native GET_EDID negotiation/error tests, dynamic 1601x901 GET_DISPLAY_INFO, W1C bit isolation, and 1,000/1,000 resize IRQ-bound stress result.
- COVERAGE — SUFFICIENT. The final native/wasm run exercised the generator, fixture, protocol encoders/decoders, feature gate, queue handlers, dynamic pmode, transport config IRQ bridge, reset path, wasm mirror, and stress path; the built-page Chromium smoke found the E5-T04 Kanban card as `rm-card st-verified` with zero console errors and zero request failures. The Makefile target and roadmap source/dist manifest are checked in. The only wasm warning was a pre-existing unused import in an unrelated `hart_ctrl` test, while the task-local GPU wasm test completed 4/4.
- SUITE: retain `make verify-E5-T04` and the checked-in EDID fixture/evidence record as the recurring proof set.
