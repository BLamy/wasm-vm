# E5-T26d adversarial predictions

Frozen before running acceptance or attack commands on 2026-09-07.

## Provenance

- Verified parent: `9a0186ad` (E5-T26c).
- Claimed implementation head: `ca002004650f0f4ec6acf302db871d2308318350`.
- Submission commit checked out: `7e436d99d1b0cdf4b1f50295b055433908a51e16`.
- Submitted evidence: `evidence/e5-t26d/native-final.json`.
- Predicted evidence SHA-256: `8f8bcf3f3f84b9c6adfe64b9368aec83760b2cfaf27b4118bc7907d7613d6c19`.
- Prediction: the only changes from the implementation head to the submission commit are task,
  queue, and evidence metadata; no runtime or test source changed.

## Falsifiable predictions

1. `make verify-E5-T26d` exits 0 at the submitted branch head with no ignored snapshot test,
   panic, or warning promoted past `-D warnings`; its sound snapshot, control, playback, queue,
   capture, capture-config, machine, and wasm32 legs all pass.
2. Versioned lifecycle round trips preserve exact PCM parameters for `Prepared`, `Stopped`, and
   `Running`. Prepared/stopped restore with no synthetic XRUN. Running output/capture restore with
   empty host queues, exactly one repair XRUN per running stream, and a forced lifecycle reschedule.
3. Mutating stream identity, rate, format, or queue count/byte metadata yields a typed refusal and
   leaves a deliberately non-default target byte-identical. No malformed output field mutates the
   capture stream, and no malformed capture field mutates output.
4. A checkpoint with one partially queued playback period restores with zero pending host periods,
   does not complete or push the old descriptor, and accepts one fresh ramp that is pushed and
   completed exactly once. A second service at the same clock produces no duplicate audio.
5. An empty restored running ring remains bounded through a 500 ms-equivalent producer stall: the
   service terminates, XRUN accounting is finite and no greater than the 256-event cap, repeated
   restores do not accumulate repair events, and a fresh period recovers without a hang.
6. Atomic event-budget refusal happens before any target mutation when restored events plus repair
   XRUNs exceed 256.
7. Novel bounded attack: every strict prefix of the 184-byte no-event payload and representative
   reserved-byte/boolean/trailing-byte corruptions are rejected without mutating a non-default
   target. This must terminate in bounded time and must not panic.
8. Coverage: every behavioral hunk in `snapshot.rs` is either directly hit by the acceptance and
   adversarial runs, classified as a malformed-input branch hit by the novel attack, or explicitly
   identified as unproven/dead. The `mod.rs` façades and playback test are exercised; Makefile/task
   metadata are inspectable waivers.

## Directed attack matrix

- Lifecycle: released baseline, prepared, stopped, running output, running capture.
- Invalid parameters: output stream id 1, capture stream id 0/2, unsupported rate enum/mask,
  non-S16 format, invalid channels, zero/over-cap period and buffer/ring metadata.
- Queue metadata: count over 4096, count/bytes zero mismatch, bytes above count × 16 MiB.
- Recovery: partial queued period, empty host rings, 500 ms stall, repeated restore, fresh ramp once.
- Atomicity: invalid payloads and event-cap overflow against a configured non-default target.

WebKit, independent-machine execution, and host rr are waived as directed.
