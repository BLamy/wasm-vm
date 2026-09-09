# E5-T26d verifier predictions

Recorded before running `make verify-E5-T26d` or the verifier attack harness.

## Frozen inputs

- PR: `#342`, base `9a0186ad0f3bd818fc034ebc1a2a378ecbfc3e37`, branch head
  `7e436d99d1b0cdf4b1f50295b055433908a51e16`.
- Implementation head: `ca002004650f0f4ec6acf302db871d2308318350`; the runtime-file diff from
  that commit to the branch head is empty.
- Worker evidence SHA-256:
  `8f8bcf3f3f84b9c6adfe64b9368aec83760b2cfaf27b4118bc7907d7613d6c19`.
- Task-scoped implementation-diff SHA-256:
  `51c390f2bc5302ce32ba0f9e7f8510f7d9d3cf57aee564d325a0f2f5c7ccb5fb`.

## Predictions

1. **Prescribed gate — HELD if** `make verify-E5-T26d` exits 0 at the frozen runtime tree and
   reports the worker-claimed test counts and wasm build success.
2. **Lifecycle fidelity — HELD if** stopped and prepared streams restore byte-for-byte equivalent
   parameters and state with zero synthetic XRUNs, while running output/capture streams retain
   configuration but restore with exactly one XRUN each.
3. **Ephemeral rings — HELD if** a checkpoint with one queued output period and one queued capture
   period restores both host-side pending counts to zero and reports one discarded transfer per
   direction.
4. **Partial playback — HELD if** the pre-checkpoint period is never sent or duplicated, a fresh
   post-restore reference ramp completes exactly once, and a second service pass does not replay it.
5. **500 ms producer stall — HELD if** advancing the deterministic audio clock by 500 ms before
   repeated restore/service cycles finishes without a hang, keeps the event queue bounded, and a
   fresh period after recovery completes exactly once.
6. **Malformed payload atomicity — HELD if** invalid output/capture stream IDs, unsupported rates,
   invalid formats, zero/unsupported rate masks, excessive transfer counts, inconsistent or
   oversized pending-byte metadata, invalid event IDs/types, and event-budget overflow are all
   rejected while the target's re-encoded snapshot remains byte-identical.
7. **Versioned fail-closed decoder — HELD if** bad magic/version/flags, non-zero reserved bytes,
   invalid booleans/states, truncation, and trailing bytes are rejected without mutation.
8. **Device wrappers — HELD if** `VirtioSnd::to_snapshot` and `VirtioSnd::restore_snapshot` exercise
   the shared state and produce the same lifecycle/XRUN contract as direct `SndState` calls.
9. **Changed-hunk sufficiency — HELD if** every behavioral hunk is exercised by the prescribed
   gate or verifier harness; defensive allocation/length-overflow arms and diagnostic-only error
   code mapping may be explicitly waived if their preconditions are unreachable under the bounded
   format and they do not weaken an acceptance claim.

## Bounded novel attack

Run a deterministic byte-mutation matrix over every fixed-header field class, always restoring
into a non-default prepared target and comparing its canonical snapshot before and after refusal.
Then repeat running-state restore/service after a 500 ms clock advance 64 times and require bounded
completion, one repair XRUN per restore (replacement, not accumulation), empty pending host queues,
and exactly-once fresh audio.
