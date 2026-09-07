# E5-T26d remediation re-verification predictions

Frozen on 2026-09-07 before running the remediation acceptance or attack commands.

## Provenance predictions

- Branch `codex/e5-t26d-sound-snapshot-xrun` is at submission commit
  `fc78300294fb4e92e5d1965500f200a0fa091e4e`; remediation implementation commit
  `2a501be6626035a6a38b75e36aa95dea0442e451` changes only
  `crates/core/src/dev/virtio/snd/snapshot.rs` relative to the previously reviewed implementation.
- `evidence/e5-t26d/native-final.json` has SHA-256
  `3263508ab45253fee95e6087811b1063c8bf2653aaa083e55963422db72a3684` and names the
  remediation implementation commit.
- The binary diff from the prior implementation commit `ca002004650f0f4ec6acf302db871d2308318350`
  through the remediation commit has SHA-256
  `e89426545ce61539ebe32be7bf47b7d5f160a768d5da181e14471c9a55576d69`.

## Carried-forward HELD predictions

The prior verifier's lifecycle fidelity, ephemeral-ring discard, partial-playback recovery,
500 ms stall boundedness, malformed payload classes other than the two period-byte cases,
event-budget atomicity, versioned decoder, device wrappers, and unchanged-hunk coverage remain
HELD. Their implementation/dependency boundary is unchanged; this pass will not relitigate them.

## Remediation predictions

1. The locked `e5-t26d-verifier` harness exits 0 with `mutation_cases=42`,
   `mutation_failures=0`, `stall_iterations=64`, one replacement repair XRUN per restore,
   empty restored playback rings, and exactly one fresh 1024-frame ramp with no stale completion
   or duplicate frames.
2. The independent `post_restore_stall` probe exits 0 after 184 atomic strict-prefix refusals,
   atomic event-count-257 refusal, and a bounded 500,000,000 ns empty-ring service.
3. The scrubbed `make verify-E5-T26d` exits 0 with six snapshot tests and all previously HELD
   sound/machine and wasm32 legs still passing.
4. Bounded novel mutation family: for output and capture independently, encode valid configured
   streams and mutate queue metadata to `pending_count=2` with `pending_bytes` equal to only one
   configured period. Both restores must return error code 13 and leave a distinctive target's
   canonical snapshot byte-identical.
5. Remediation coverage is sufficient only if decode performs parameter-aware validation before
   restore assignment, encode uses the same invariant, the promoted regression hits both stream
   directions, and the locked harness hits the exact two formerly accepted payloads. Defensive
   encoder-only and impossible arithmetic/allocation arms may retain the prior waiver.

Independent machines, WebKit, and host rr remain waived by user direction and repository policy.
