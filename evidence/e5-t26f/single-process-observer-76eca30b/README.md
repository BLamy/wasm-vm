# Post-PLIC desktop screen: deadline failed

Producer `76eca30b248268e130395c53cb09da62637388a7`, after independently verified O.
Command: `env -u RUSTDOCFLAGS node tools/verify/e5-t26f-browser-single-process-observer.mjs`.
Cold child0, reuse child1, outer0. The wrapper explicitly records a diagnostic,
not acceptance; outer success does not turn the failed timing assertion green.

Original restore T0 `1175.460000038147` to frozen end `5178.40499997139`:
**4002.944999933243 ms > 2000 ms**. Failure is the unchanged runner line1930.
Raw `reuse/failure-post-restore-interaction-checks.json` SHA256:
`1b73c811b9abc99d2d7172323e42f3f97dc66e0d13d76468717a75ed5d3b94dc`.

## Exact retained inputs

- WASM: `20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238`.
- Runtime tree: `18953aff6f7cbab92d13460912bbb868a951b42ad7b5aadfdadc1e46b0913190`.
- Held image: `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`.
- Snapshot: `573f27b65af05197d1b30a4c745be5582500653e0c031541333ff99da410f1ae`,
  2809522 bytes, saved/restored CRC `e0c300b9`, overlay generation623.
- Closed profile tree: `f634092cc1fa969084d9316f07d4c8dbfdc9685cba445b933d20c049d516efaf`.
- Retained root:
  `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-yj0SBu`.
- Origin `http://127.0.0.1:61637`; full browser identity, invocation/source pins,
  configuration, profile-copy path and checkpoint provenance are in the raw records.

New empty cold preparation starts2026-09-08T21:35:06.566Z. This is not an old seal
rebound to a changed runtime. Kernel/image/helper/binary proof is unchanged from the
held records. No compiler, runtime, harness, source, image or HEAD edit occurred
during the recording. Default JIT1, decoded4096, repack-off24 and disabled entry
timers remain observed. No CPU, guest-PC, latency or COMPLETE override was used.

## Reached functionality, not timing acceptance

Viewed `cold/resident-prepared.png` and the failure PNG show two terminals and
fresh player PID1000/start28741 in the pre-1/pre-2/post observations. FIFO3 is
readonly in the child, parentFD3 is RDWR, no child writers, PCM4 owner1000 is
PREPARED with zero pointers. The physical `play` produces10 matching keyboard/DOM
edges,8497 changed pixels, a green completion marker, child completion and prompt.
Moved cursor is guest684/392, hotspot1/1,94 matched pixels, observed783.320ms
after T0. This is a recorded rendered observation, not first-arrival timing.

Post-restore audio writes1440 fresh frames; all1440 inspected frames are non-silent.
Audio is attached, unlocked and running. The immediate completion observation is
at5168.645ms page time; it does not establish the first PCM-arrival time. Later
coherence admission, drag/second reload are not reached after the cap failure.
The failure record lacks the complete reuse browser/HTTP error arrays; do not
generalize a presentation-local empty array into a whole-run zero-error claim.

Sequential JIT RPCs bracket wider spans, not an atomic F interval. Their counters
show continued execution/compilation with queue backpressure; they do not identify
the latency cause. `observation.json` preserves all raw endpoint values and exact
queue accounting. The prior PLIC CPU percentage and this single run do not prove
a causal speedup. F, Epic5 and Omarchy production remain unfinished.

Independent Daybreak review is retained under `../plic-runtime-verifier/`.
Any subsequent HEAD/runtime edit invalidates this checkpoint for new-runtime use.
