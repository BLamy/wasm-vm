---
id: E5-T26d
epic: 5
title: Virtio-snd stream snapshot and XRUN restore
priority: 526.4
status: pending
depends_on: [E5-T26c]
estimate: S
risk: high
capstone: false
---

## Goal

Persist virtio-snd stream configuration and restore running playback through the explicit XRUN
path while keeping host SAB audio rings ephemeral.

## Boundary

Own stream state, period/ring metadata, restore-time XRUN signaling, and empty-ring recovery.
Do not redesign the AudioWorklet, autoplay policy, or the desktop browser flow.

## Acceptance criteria

- Stopped, prepared, and running streams serialize with versioned state and restore to the same
  configuration; running streams restore as XRUN-pending rather than pretending DAC time survived.
- Restored SAB rings are empty, the guest receives the XRUN/report, and one subsequent user
  gesture plus `speaker-test`/reference ramp produces valid audio with no hang or duplicate block.
- Invalid stream ids, rates, formats, and ring lengths fail closed without affecting other streams.

## Verification command

make verify-E5-T26d

## Adversarial verification

Checkpoint during `aplay` with a partially consumed period and during a 500 ms producer stall;
restore repeatedly and require a bounded XRUN recovery or clean failure, never a hung stream.

## Verification log

(empty)
