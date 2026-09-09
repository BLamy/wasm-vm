VERDICT: verified

- **P1 attribution failures — HELD.** Predicted normal callback errors, throwing
  retired/fallback getters, and a thrown object with a hostile `message` accessor would
  remain diagnostic-only. Source and dist each emitted the failure as null/null between
  totals 40 and 100, then emitted 60/100 and 75/175, proving the baseline stayed at 40;
  all four presents returned true, successful/drawn counts reached four, drops remained
  zero, and a string diagnostic was retained
  (`attack-results.json:971-1224,2257-2510`).
- **P2 strict attribution and recovery — HELD.** Predicted invalid scalar and object
  values would not invoke numeric coercion or move the baseline. Null, undefined, string,
  boolean, boxed/coercible object, NaN, infinity, negative, and unsafe values all produced
  null/null, followed by exactly 100/100 and 75/175 in source and dist. The null-retired /
  throwing-fallback getter was also contained (`attack-results.json:11-970,1101-1158,
  1297-2256,2387-2444`).
- **P3 parity, isolation, and release proof — HELD.** Main source/dist, presentation
  source/dist, and helper JS/TS bytes are identical. Exact bounded blocks establish the
  unique AND gate, raw strict-number assignment, owner guard, unique 50 ms sampler,
  clear/null teardown, baseline reset, record cap, and false/false/false/true query truth
  table (`static-audit-results.json:3-49`). The submitted release audit itself uses four
  bounded blocks, and independent gate/guard/sampler/timer/baseline mutations all exited
  nonzero (`release-audit-sabotage-results.json:3-30`).
- **P4 exact gate and artifacts — HELD with the permitted listener limitation.** At
  `57c2cc828c151c830ebd7a377dc29d7bf898566d`, the target passed all syntax checks, 10/10
  focused tests, and the strict release audit; localhost bind then failed with
  `listen EPERM 127.0.0.1` (`make-verify.log:1-36`). No semantic attack was waived.
  Retained Chromium 152 and Firefox 132 records passed normal-off/full-on checks; all
  requested hashes recomputed, including PNG
  `7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547` and demo
  `0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd` /
  `aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1`.
  The demo JSON is 126/126/0 with empty browser/HTTP errors, and both PNGs were visually
  inspected (`integrity-results.json:3-99`; `visual-inspection.md`).
- **P5 prior attacks — HELD.** Twenty-four delayed dual-operation trials retained whole
  frames through sync; rejected/fulfilled/fulfilled queue recovery kept sequences 2/3;
  stale and duplicate transitions were exact no-ops with stable sequences; invalid damage
  left the next 16-byte present intact; the null sink reported zero drawn work; and five
  records plus source/dist schemas were byte-stable (`attack-results.json:2583-4349`).
- **P6 novel hostile diagnostic — HELD.** A revoked proxy thrown by the attribution
  callback defeats both property access and `String(error)`. Source and dist still emitted
  null/null, preserved the 40 baseline, returned true four times, retained four successful/
  drawn presents, recorded zero drops, and stored exactly
  `guest instruction telemetry: unavailable` (`attack-results.json:1227-1294,2513-2580`).
- **COVERAGE — SUFFICIENT.** The pass-five source/dist fallback hunks and promoted test
  were dynamically executed. Prior `HELD` classifications carry forward because their
  implementation boundaries are unchanged; requested prior behaviors were still replayed.
  The Linux-owner sampler lifecycle has a precise bounded-static waiver due the listener
  restriction. No changed runtime hunk is uncovered or dead (`coverage-audit.md`).
- **SUITE:** retain the worker's hostile-message regression in the 10-test focused target,
  retain the revoked-proxy attack as verifier evidence, and retain the strict release audit
  plus five sabotage cases. No additional promotion is permitted by this verifier's
  evidence-only write scope. Independent machines, WebKit, ssh-dev, host rr, merge, and
  E5-T25b remain waived or out of scope.

Commands: `make verify-E5-T25a`; `node evidence/e5-t25a/verifier-r5/attacks.mjs`;
`node evidence/e5-t25a/verifier-r5/static-audit.mjs`;
`node evidence/e5-t25a/verifier-r5/release-audit-sabotage.mjs`;
`node evidence/e5-t25a/verifier-r5/integrity-audit.mjs`; exact diff/source inspection;
SHA-256 recomputation and original-resolution visual inspection of both retained PNGs.
