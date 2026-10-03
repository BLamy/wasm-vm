# Pre-freeze receipt falsification

2026-10-03. Prediction P9 requires exact JSON integer counters.

- NEEDS EVIDENCE / harness correction: `tools/virgl-indirect-constants/consumer_receipt.py`
  compares the V8 `checkIndirectBank` call count with ordinary Python equality.
  Independent clean recording `receipt-consumer-clean/report.json` validates.
  In `receipt-consumer-float-coverage/coverage.json`, only that root range count
  changes from integer296 to JSON296.0; the coverage binding in report.json is
  recomputed. `consumer_receipt.verify_recording` still returns `status: passed`.
  This is a proof-schema gap, not a product semantic contradiction. Require typed
  integer counters and recheck the mutation on the final frozen evidence.

Repro recording: `node tools/virgl-indirect-constants/consumer-unit.mjs --output
 evidence/virgl-indirect-constants/verifier/receipt-consumer-clean`.
Control and forged outputs from verifier exec both read `passed`.

Independent native harness first attempt corrected two verifier expectation
mistakes before declaring any result: the nested join includes all bit-compatible
values of {0,45,1}, and partial CONST declarations are rejected by the inherited
profile regardless of consumed lane. No implementation finding was raised.

Mesa source checked directly: https://docs.mesa3d.org/gallium/tgsi.html#opcode-UARL
(UARL copies an integer source into an address register.)

- NEEDS EVIDENCE / harness correction: native serialization maxima were also
  compared only through Python numeric inequalities. On the independently
  validated preflight `/tmp/virgl-e8-native-preflight3`, changing either
  `stats.maxSingleResultBytes` or `stats.maxPairResultBytes` to an equal-valued
  JSON float, changing the matching `STATS` line in native.log, and recomputing
  `logSha256` still returns `passed`. Controls and both mutated copies were run
  in the same loaded verifier process. Copies are `receipt-native-max-single-float`
  and `receipt-native-max-pair-float`. Worker informed before source freeze.

Final resolution: all three pre-freeze schema gaps are HELD after worker
hardening at b4ee940d78f651553c2b900be95f8b083085cdf9. Final clean controls pass;
the actual copied-record mutations reject for the intended exact-type guards,
not stale-source or missing-file errors. See final-receipt-attacks.json.
