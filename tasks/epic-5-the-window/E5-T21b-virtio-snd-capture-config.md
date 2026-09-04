---
id: E5-T21b
epic: 5
title: Config-gated virtio-snd capture advertisement
priority: 521.2
status: pending
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

(empty)
