# E5.5-T03as independent verifier predictions

Recorded before inspecting AS runtime evidence. Starting task commit: `a11f3673`.
This verifier did not implement AS. AR/AO/AQ proof is carried only where the code,
artifact identity and evidence digest remain unchanged.

1. **Artifact and kernel identity.** The bytes restored by the physical run have
   AR snapshot SHA256 `265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8`
   and delta `1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c`.
   The runtime WASM remains AO, and an actual independent serial read of
   `/sys/kernel/notes` identifies AQ's kernel before any physical key event.
   Replacing a provenance field or supplying old AJ bytes must fail closed.
2. **Uninstrumented original configuration.** One owned fresh browser has
   original 1280x800 presentation, ICount64, JIT recycling enabled and cap256;
   no syscall observer, CPU profiler or entry timing affects the measurement.
   Startup <=300s, typing <=60s, response <=120s from Enter, capture <=20s and
   owned cleanup <=30s are not extended after observing a failure.
3. **Physical-only write.** Trusted physical key transitions and raw host
   acknowledgments reconstruct exactly the nonce-writing terminal command.
   Every serial/RPC command is read-only with respect to that nonce path.
   Neither a command echo nor host input delivery suffices for acceptance.
4. **Real application response.** An independently read guest file contains
   exactly the new random nonce by Enter+120s with exit status zero, in the
   same run and browser instance; stale or mismatching nonce bytes fail.
5. **Visible response.** A fresh captured real screenshot from after the
   physical trial visibly contains the command and returned prompt. A stale
   image, frame counter or changed-pixel count cannot substitute for inspection.
6. **Error and ownership boundary.** There are no unexpected browser errors;
   all owned child processes close within cleanup budget and the run preserves
   any negative result rather than changing the trial or silently retrying it.
7. **Default and coverage boundary.** The existing AJ-only path keeps its exact
   source/Foot identity guard, and the explicit AR route checks saved Foot473 at
   address `0x55558518d650` before input. Each AS changed behavioral branch is
   exercised by the real recording or a directly relevant bounded guard test.

Planned independent bounded attack: mutate the expected/result nonce relationship
on a syntactically valid physical-trial report and require the AS acceptance audit
to reject it; inspect any screenshot proof's freshness binding before accepting.
If the real response fails, predictions 4/5 remain failed or need evidence and
the release task Q stays gated. No responsiveness claim will be inferred from AQ.

## R2 capture correction prediction

Added after r1's personally observed empty-prompt image, before inspecting r2's
report/image. Frozen correction: `ab7bc0bc`. Physical/source/default guard holds
from r1 carry where unchanged. The AS-only new baseline must be sampled after
the real nonce response, and a later frame must complete capture within the same
20s budget. An old pre-nonce frame or a baseline timestamp before nonce completion
must be rejected. Regardless of frame counters, the actual final image must show
the typed command and returned prompt; otherwise visible response remains failed.
