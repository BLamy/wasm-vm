# Incremental predictions after implemented handoff

Read the runtime/harness delta 2da168d7..66bb2a48019d089756cdfaee3d5ea578f156bc28
before reading final evidence. Claim commit 25323636. Initial evidence/reports
remain unchanged. The only runtime delta is presentation.js (source/dist).

- F1: Rerunning the identical independent odd transition attack now reports zero
  mismatching pixels in all six backend/DPR cases, including both partial matching
  frames before RAF. The old reports remain refutations of 2da168d7 only.
- F2: Mismatch stays true after receipt of a matching resource until successful
  delivery. The first delivered matching frame uses full damage despite coalescing;
  later same-size damage retains its original partial rectangle.
- F3: Resize/activation invalidate painted dimensions. Immediate resize replay,
  WebGL replacement replay without another frame, and disposal remain correct.
- F4: Final evidence hashes equal handoff digests, records 66bb2a48, and binds
  current runtime sources/dist. All six coalesced cases clear mismatch after
  verified pixels. Main-app real paused fixture accepts its actual viewport.

Carry P1/P2/P5 and unchanged stale-frame clipping/resource bounds forward subject
to digest checks. Run only the original bounded attack and the touched deterministic
test for F1-F3; inspect the recorded scoped submission for F4 and hunk coverage.
