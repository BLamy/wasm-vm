# E5-T26f JIT latency extension — bounded fresh-critic result

RESULT: diagnostic extension held; counters localize mixed low JIT coverage plus short translated entries. This is not E5-T26f acceptance or a timing waiver.

Reviewed frozen harness diff `b13c6ce0..43f4cac1ca87af3645a24d2eed12246e84c6593a` across only the F runner and Node test. Diff SHA-256: `2db91a06c3ea4a617ff1de7088bb9c0b8c5e5fa990e2385fdb284f1bf33aaf63`. The prior seven latency-probe results remain HELD unchanged.

## Prediction results

- **P1 isolation — HELD.** The exact-head record is diagnostic reuse with latency enabled and `acceptance:false`. Source and the independently rerun 49-test suite prove default acceptance and ordinary diagnostic reuse never call `jitStats()` or create latency milestones.
- **P2 single-slot ordering — HELD.** Fifteen samples complete both scheduler and JIT observations with zero ordering or inter-sample overlap violations. Scheduler observation always precedes JIT request; the next scheduler request always follows prior JIT settlement. A sixteenth scheduler request is `pending-at-stop` and correctly has no JIT request. Stop/late-settlement adversarial tests pass.
- **P3 bounded payload — HELD.** Every completed sample contains only the named scalar JIT fields and four `entryCost` scalars. `hasExecutor` is consistently true; `timingEnabled` is consistently false and `timerReads` consistently zero. Missing/unbounded/non-finite alternatives are covered by the Node fixture.
- **P4 primary high-share prediction — FAILED as a prediction, not a harness finding.** Between the first completed sample at `877.745 ms` and last at `4670.990 ms`, guest-retired delta is `48,479,407` and JIT-retired delta is `17,892,685`, a JIT share of `36.9078%`, below the predicted 80% high-share case.
- **P5 low-coverage/short-entry alternative — HELD.** The interval leaves `30,586,722` instructions outside JIT (`63.0922%`). It adds `1,200,375` host/engine entries and `3,213,332` direct-chain entries: `14.906` JIT-retired instructions per host entry, `5.568` per direct-chain entry, and `2.677` direct entries per host entry. JIT is active but frequently returns across the host boundary.
- **P6 delta discipline — HELD.** All ratios use the first and last completed cumulative samples, not absolute totals. Over the same interval, state-copy bytes increase `210,108,368` (`175.036` bytes/host entry), cache installs `499`, evictions `98`, and retranslations `254`. `compiledBlocks` is not differenced because it is not monotonic in this record.
- **P7 diagnostic-only interpretation — HELD.** Maximum scheduler-stat RPC duration is `43.450 ms`; maximum JIT-stat RPC duration is `50.805 ms`. These serialized probes can perturb wall time, and entry-cost timing is disabled, so the record does not quantify which boundary dominates or establish uninstrumented acceptance performance.

## Replay and functional observations

- The original clock remains intact: restore/start `1169.1100000143051`; first observed non-silent PCM `3644.314999938011 ms`; first conditional marker `4919.429999947548 ms`; interaction end `4937.409999966621 ms`. The unchanged assertion fails with `post-restore interaction exceeded 2 seconds`.
- The immediately preceding PCM sample is still zero at `3592.6999999284744 ms`, so PCM begins in `(3592.70, 3644.31] ms`, unambiguously after the deadline.
- The inspected PNG shows real guest-visible `sh /tmp/a`, an ALSA underrun report, the conditional green success marker, and returned prompt. Completion PCM is positive (`1,440` written, `960` non-silent, positive amplitude). This supports successful browser recovery/functionality, not an exact native frame-count claim.

## Evidence

- Canonical JSON SHA-256: `376d60bb1cb64cd8102f9f224ac6184be507c2e5214995b3f29ea1db06d28107`.
- Inspected canonical PNG SHA-256: `f94c68314bf7564e593006f471744dc3586c8a7ce06982a5f6800833882258cd`.
- Canonical server log SHA-256: `08c14d937c67496d67bfcf97767f9f47822637162492fe4982bf3daebd80653c`.
- Pre-evidence predictions SHA-256: `d5de9c8dc2ac4556cf0dd9a91d017bba17436a93f00cfb097a023652eefd5555`.
- Independent `node --test tools/verify/e5-t26f-browser-roundtrip.test.mjs`: 49/49 passed, including serialized scheduler→JIT ordering, pending-stop/late-settlement refusal, scalar filtering, missing-JIT handling, and zero default-path access.

No F task status, runtime source, T19a/H boundary, acceptance deadline, or residency-policy claim changes here. A future bounded A/B could test residency policy, but prior cap-256 resize failure is not candidate promotion evidence and is not used in this result.
