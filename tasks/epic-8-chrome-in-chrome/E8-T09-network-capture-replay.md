---
id: E8-T09
epic: 8
title: Network capture and replay — deterministic, offline re-execution of a browsing session
priority: 809
status: pending
depends_on: [E8-T05]
estimate: M
capstone: false
---

## Goal
Make the network a **replayable input, not a live dependency**: record every byte the guest
receives from the network (at the virtio-net / transport boundary) into the trace, so a recorded
browsing session **replays deterministically and offline** — the remote servers are gone, but
the recording reproduces exactly what they sent. Without this, replay of a real web session is
impossible (the network is nondeterministic and non-repeatable).

## Context
Network responses are the largest and least-repeatable nondeterminism source for a browser.
Capture at the VM boundary (E8-T04 records virtio-net RX with timing keyed to the deterministic
clock); reference large payloads by hash into a content store (E6-T16 machinery) to keep traces
bounded and dedupe repeats. Replay re-injects the recorded RX at the recorded delivery points with
no live sockets. Interaction with E7-T06's network stack: recording sits below the guest stack, so
TCP/TLS state is reconstructed by the guest from the replayed bytes (we record what the guest saw,
not a proxy of the remote). Handle TLS: since we replay ciphertext the guest already decrypted
deterministically (its RNG/keys are clamped via E8-T03), replay reproduces the same session.

## Deliverables
- Network RX/TX capture integrated into the record engine, with hash-referenced payload storage
  and clock-keyed delivery points.
- Offline replay: a recorded session replays with the network transport fully disconnected.
- A test: record a real multi-request page load, disconnect the network, replay, and verify the
  page renders identically (frame/state hash match).

## Acceptance criteria
- [ ] A recorded real-web session replays **fully offline** (transport disabled) and reaches
      bit-identical state / identical rendered result to the live recording.
- [ ] Large/repeated payloads are hash-deduped; trace network size stays within budget for a
      realistic browsing session (measured).

## Adversarial verification
Record a page load, then **physically disable** the network and replay — any attempt to reach the
network, or any divergence, refutes offline determinism. Record a session hitting a page that
changes every request (a clock/random endpoint) and confirm replay reproduces the *recorded*
response, not a fresh one. Confirm TLS sessions replay (the clamped-RNG assumption from E8-T03
holds — if replay needs a live handshake, that's a determinism hole). Corrupt a recorded payload
and confirm replay detects the mismatch. Measure dedupe on a session that reloads the same page
twice (second load should add little trace).

## Verification log
(empty)
