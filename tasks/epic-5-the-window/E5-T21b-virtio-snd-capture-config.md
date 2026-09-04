---
id: E5-T21b
epic: 5
title: Config-gated virtio-snd capture advertisement
priority: 521.2
status: verified
depends_on: [E5-T21a]
estimate: S
risk: high
capstone: false
---

## Goal

Make microphone capture an explicit VM-creation feature: `enable_mic=false` is playback-only and
`enable_mic=true` advertises exactly one deterministic input PCM stream.

## Boundary

This slice owns device-creation configuration, PCM_INFO stream enumeration, input format/rate
metadata, and reset/config persistence. It must not request `getUserMedia`, consume a capture ring,
or add permission UI.

## Deliverables

- `enable_mic` configuration carried through native and WASM machine construction.
- Input PCM_INFO entry with documented S16 mono/stereo and 48 kHz capability truth.
- Native fixtures proving playback-only compatibility and stable stream numbering.

## Acceptance criteria

- [ ] With the flag off, PCM_INFO exposes no capture stream while the existing playback stream and
      stream numbering remain unchanged.
- [ ] With the flag on, PCM_INFO exposes one INPUT stream with exact format/channel/rate metadata;
      unsupported rates and malformed selectors remain non-mutating.
- [ ] Reset and repeated device creation preserve the selected gate without opening a host device.

## Verification command

`cargo test -p wasm-vm-core --test virtio_snd_capture_config`

## Adversarial verification

Query stream IDs and selectors in every order, toggle the flag across fresh machine construction and
reset, request unsupported rate/channel combinations, and assert that playback descriptors and
guest-visible slot ordering never change.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified (user-directed)

- **Playback-only compatibility — HELD.** Predicted `enable_mic=false` would keep one output PCM
  stream, preserve the existing stream-0 rate contract, and leave the established virtio slot
  layout unchanged. The exact-head native fixture held: slot 6 remains sound after blk/net/keyboard/
  pointer, stream 1 selectors return `S_BAD_MSG`, and playback still accepts 44.1 kHz.
- **Capture advertisement and metadata — HELD.** Predicted `enable_mic=true` would advertise exactly
  stream 1 in every selector order with INPUT direction, S16-only format, mono-or-stereo channels,
  and a 48 kHz-only rate bit. Native PCM_INFO byte assertions and the built Chromium WASM
  construction proof held those exact values.
- **Malformed/non-mutating paths — HELD.** Predicted unsupported 44.1 kHz capture, a three-channel
  request, zero-count/out-of-range/multi-stream selectors, and a short item size would return
  `S_BAD_MSG` without changing either stream's lifecycle or parameters. The fixture held all
  predictions, then accepted a valid mono 48 kHz capture request.
- **Reset, construction, and privacy boundary — HELD.** Predicted reset would clear lifecycle
  state but preserve the selected capture gate, and repeated fresh construction would reproduce
  the same configuration without a host media handle. Native reset/recreation assertions held;
  Chromium's `getUserMedia` spy observed zero calls while assembling paused with `enableMic:true`.
- **Coverage and reproducibility — HELD.** At implementation head
  `306c598412dcc4e2a49ac11110a70f82564a03f6`, the acceptance test passed 4/4, 25 consecutive
  focused reruns passed 4/4, affected sound suites passed 29/29, core/CLI/WASM lint and wasm32
  builds passed, and the Chromium construction spec passed with zero unexpected console errors.
  Evidence transcript: [`virtio-snd-capture-config-2026-09-04.txt`](../../evidence/e5-t21b/virtio-snd-capture-config-2026-09-04.txt),
  screenshot: [`virtio-snd-capture-config-2026-09-04.png`](../../evidence/e5-t21b/virtio-snd-capture-config-2026-09-04.png).
- **SUITE — HELD.** Retain the native creation/config fixtures and browser construction proof;
  host capture, permission lifecycle, rings, and end-to-end recording remain in E5-T21c–e.
- Findings: none. The task is verified.
