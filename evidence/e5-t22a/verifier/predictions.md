# E5-T22a fresh verifier predictions

Written 2026-09-06 after reading AGENTS.md, the entire task and textual diff
af6b4bf4..8c3f4e14477292d329783d0eee7451a63d0644fe, before inspecting any
worker evidence or executing an attack. Binary diff will be bound by SHA-256.
No verdict/status change is authorized before final implemented handoff.

- P1 strict atomic validation: each invalid JS value in either argument throws a
  bounded dimension error; a valid first dimension with invalid second leaves
  complete stats (including EDID, event, resource state) identical. 1 and 4095
  succeed. EDID bytes 56/58 and 59/61 decode to the requested dimensions, length
  is 128, and sum modulo 256 is zero. Returned EDID mutation cannot change device.
- P2 resource preservation: after 1000 requests the advertised mode is 750x531,
  but resource 17 remains 7x5, 140 bytes, one resource, identical original pixels.
  After removing the actual resource stats report zero allocation and null
  scanout, including when the stored scanout ID is stale. Unchanged T04 tests
  retain config event coalescing; new getter must neither clear nor signal it.
- P3 bounded unavailable/reentrant access: absent GPU returns false/null. Holding
  a mutable LinuxInner or GPU RefCell borrow makes both new APIs return errors
  without panic. Valid calls after release still work.
- P4 real transports/lifecycle: built direct and module-worker controllers reject
  32 invalid argument pairs each, accept 1003 modes, and finish with equal actual
  stats at 750x531, zero resources, null scanout, EVENT_DISPLAY=1. Direct stop
  returns false/null and worker stop rejects RPCs. Pre-boot demo returns false/null.
- P5 guest event evidence: after host request 1371x903, the second retired guest
  instruction LW at GPU events_read address 0x10008100 writes x10=1. Trace/digest
  must be tied to the frozen head. No compositor adoption is inferred.
- P6 visible demo: host-only diagnostic shows advertised 1367x901 with no scanout;
  built main demo finishes 126 passed/0 failed, zero non-favicon errors, and
  roadmap language keeps compositor adoption pending.
- P7 provenance/coverage: final clean clone is exactly the frozen head with clean
  tracked state and scrubbed Rust/Cargo environment; full prescribed gauntlet
  plus make verify-E5-T22a succeeds. Evidence/source/bundle digests match, and
  every changed hunk is executed or individually justified as waived.
- A1 bounded independent odd-mode attack: send 65 deterministically generated
  odd dimension pairs using seed 0x22a5c019, interleave invalid second arguments,
  and read after each real worker RPC. Every read must match independent mode
  and EDID decoding, repeated stats must not ACK events, edited returned EDID
  must not alias device state, no resource/scanout may appear. Final stop rejects.
- S1 sabotage: serve an in-memory altered copy of the deployed loader that makes
  setDisplay return true without calling WasmLinux. The worker's newly added
  browser acceptance harness must fail on requested mode state. Do not edit any
  implementation file; record the injected response and the failed assertion.

Final worker files are not yet handed off. Existing iteration evidence is excluded.

## Target amendment before final evidence inspection

Worker reports head 0fe393ed9bac81a88ae454b68fe813b2cd209c0a, a Makefile-only
correction adding --features gpu-trace to the native GPU acceptance test command.
Verified the full inter-head diff: runtime, browser harness, and deployed bundle
are unchanged. P1-P6/A1/S1 predictions carry forward. P7 now expects acceptance
at 0fe393ed9bac81a88ae454b68fe813b2cd209c0a and explicitly records broad gate
baseline failures rather than claiming make ci passed. Compare the recorded
diagnostics to unchanged source; do not demand unrelated Linux-on-Mac fixes.

## Bounded coverage extension, before execution

C1: exercise the diagnostic's direct UI selection and its error/busy branches;
an invalid submitted mode must display a dimension error and preserve stats.
C2: boot the main page through its existing testHooks/startPaused support using
an explicitly served eight-byte fixture manifest, then invoke active wvmDemo
wrappers. At 997x613 they must match actual controller stats, with null scanout;
the fixture remains paused. This covers forwarding only, not Linux/compositor.
C3: force Reflect.set to throw while calling a directly instantiated real
WasmLinux displayStats, restore it in finally, and expect the bounded property
error followed by usable unchanged stats. No source mutation.

## Portability amendment before final evidence inspection

Final proposed proof head is 179b8fd04e716a24a7b15091b3f7b0de0a356dfb. Worker
reports the prior cold browser run exposed missing deploy-staged Alpine
manifest input. The updated server must serve the committed source manifest
using the same staging input as tools/deploy-cloudflare.sh, and bind its hash.
Predict that a NEW scrubbed clean clone's make verify-E5-T22a completes without
depending on the original working directory's untracked deployed manifest.
P1-P6/A1/S1 remain unchanged; compare complete inter-head diff before carrying.
Earlier portability failure cannot count as a successful clean-clone proof.
