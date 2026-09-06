VERDICT: refuted

- **P1 unavailable and valid attribution — HELD for ordinary values.** Predicted scalar,
  `retiredInstructions`, and `guestInstructions` null/undefined/invalid samples would emit
  null/null without advancing the baseline, followed by 100/100 and 75/175. Numeric
  strings, booleans, boxed/unsafe/non-finite/negative values, malformed/null-prototype
  objects, and callback throws all held; valid zero remained valid. Source and committed
  dist ordinary paths were byte-equivalent (`attack-results.json:54-1139`).
- **P2 parity, scheduler guard, lifecycle, and isolation — HELD with a static waiver.**
  Source/dist main and presentation files and JS/TS helpers are byte-identical; the cache
  has one raw-value strict-number guard owning its one assignment; the sampler is uniquely
  under the exact dual gate; teardown clears/nulls its interval and resets its baseline;
  normal/test-only/perf-only/full truth is false/false/false/true
  (`static-audit-results.json:3-39`). The submitted release audit uses over-broad gate,
  cross-block sampler, and clear-only regexes (`static-audit-results.json:40-46`), so its
  lifecycle claim is accepted only through the verifier's bounded-block static audit.
- **P3 exact gate/browser/demo — HELD except for the documented environment leg.** The
  exact target at `a1c25437bed33910218eece228a77b230abfb8e9` passed syntax checks, 8/8
  focused tests, and the release audit, then the sandbox rejected the existing browser
  harness listener with `listen EPERM 127.0.0.1` (`make-verify.log`). Per scope, no listener
  escalation was attempted. Committed exact-head Chromium 152 and Firefox 132 artifacts
  retained normal-off/full-on behavior; all browser/demo hashes recomputed, including the
  full PNG digest `7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`,
  and the demo is 126/126 with no browser/HTTP errors (`integrity-results.json:3-90`).
- **P4 prior held attacks — HELD.** Sixteen delayed trials in both call orders preserved
  whole frames through sync; rejected-operation recovery produced rejected/fulfilled/
  fulfilled with unique sequences 2/3; stale/duplicate state, invalid damage, null sink,
  five stable records, and source/dist schema parity all matched predictions
  (`attack-results.json:1142-2364`).
- **P5 bounded novel invalid attribution — FAILED.** Predicted a supported object-form
  sample whose `retiredInstructions` getter throws would be treated as unavailable and
  preserve a successful drawn present. The callback invocation is caught at
  `web/src/sink/presentation.js:271-276`, but property extraction occurs outside that
  try at lines 277-279. Observed: the first backend draw occurred, yet no null/null record
  was emitted, `present()` returned false, and telemetry claimed one dropped frame while
  also claiming three successful/drawn presents (`attack-results.json:8-50,3559-3595`).
  Contain property extraction/normalization errors inside attribution handling, emit
  null/null without advancing the baseline or converting a drawn present into a drop,
  and promote this regression before resubmission.
- **COVERAGE:** every changed implementation hunk is dynamically exercised or receives
  the precise deterministic static waiver above; no dead hunk was found. Full
  classification: `coverage-audit.md`.
- **SUITE:** retain the ordinary unavailable→100→175 regression and pass-three attacks;
  promote the throwing-getter containment case after the fix. No independent-machine,
  WebKit, ssh-dev, host-rr, T25b/T25c/T22c, or merge work was performed.

Commands: `make verify-E5-T25a`; `node evidence/e5-t25a/verifier-r3/attacks.mjs`
(expected nonzero on the refutation); `node evidence/e5-t25a/verifier-r3/static-audit.mjs`;
`node evidence/e5-t25a/verifier-r3/integrity-audit.mjs`; source/dist/helper `cmp -s`;
`shasum -a 256` on browser/demo artifacts; syntax checks; exact diff/source inspection.
