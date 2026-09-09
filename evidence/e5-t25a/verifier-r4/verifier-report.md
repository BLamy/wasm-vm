VERDICT: refuted

- **P1 invalid samples and recovery — HELD.** Predicted scalar and supported object-form
  null/undefined/string/boolean/boxed/non-finite/negative/unsafe values would emit
  null/null without moving the baseline, then 100/100 and 75/175. Source and dist did
  so; ordinary callback errors also retained successful/drawn presents, zero drops, and
  diagnostics (`attack-results.json:112-1236`).
- **P2 promoted getter containment — HELD.** Predicted a throwing
  `retiredInstructions` getter, including the nullish-retired/fallback-getter variant,
  would be diagnostic-only. Source and dist returned true, emitted null/null, preserved
  100/175 recovery, retained drawn/success counters, and recorded zero drops
  (`attack-results.json:1270-1439`).
- **P3 parity/lifecycle/release audit — HELD.** Source/dist main and presentation files
  and helper JS/TS are byte-identical. The exact dual gate, raw strict numeric cache
  assignment, owner-guarded sampler, unique 50 ms timer, surface gate, teardown nulling,
  and baseline reset are all present inside bounded slices
  (`static-audit-results.json:3-49`). The updated release audit itself uses four bounded
  blocks, and five independent mutations of its gate, guard, sampler setup, timer
  nulling, and baseline reset all failed the audit (`release-audit-sabotage-results.json:3-30`).
- **P4 exact gate/browser/demo — HELD with documented listener limit.** At exact head
  `f7cee38b`, syntax, 9/9 focused tests, and the release audit passed before localhost
  bind failed with `EPERM`; no listener escalation was attempted (`make-verify.log`).
  Retained Chromium 152 and Firefox 132 records passed normal/full checks; retained
  source/dist four-query isolation is 16/16. All requested hashes recomputed, the worker
  log contains the full PNG/current demo digests, and the visually inspected demo is
  126/126 with empty browser/HTTP errors (`integrity-results.json:3-99`).
- **P5 prior attacks — HELD.** Sixteen delayed trials in both call orders retained whole
  frames through sync; rejected-operation recovery was rejected/fulfilled/fulfilled;
  stale/duplicate transitions were exact no-ops with stable sequences; invalid damage
  left the next present intact; the null sink drew nothing; five records were identical;
  and source/dist schemas matched (`attack-results.json:1644-2865`).
- **P6 novel hostile attribution — FAILED.** Predicted a throwing callback whose thrown
  value has a hostile `message` accessor could not convert an already-completed draw into
  a drop. In both source and dist, the accessor escaped while the telemetry catch tried
  to format it (`web/src/sink/presentation.js:276-278`), reached the outer present catch
  (`web/src/sink/presentation.js:376-387`), omitted the first null/null record, returned
  false, and incremented dropped frames to one even though all three backend calls were
  successful and drawn (`attack-results.json:8-108,1442-1540`). The result repeated
  identically twice. Make diagnostic formatting itself non-throwing inside attribution
  containment, preserve the successful present, and promote this exact regression.
- **COVERAGE:** every hardening hunk is executed, generated-parity waived, declarative,
  or bounded-static waived; no dead hunk. The semantic failure is executed coverage, not
  a gap. Full classification: `coverage-audit.md`.
- **SUITE:** retain the worker getter regression and pass-four attacks; promote the
  hostile thrown-diagnostic case after the fix. No merge, next task, independent machine,
  WebKit, ssh-dev, or host-rr work was performed.

Commands: `make verify-E5-T25a`; `node evidence/e5-t25a/verifier-r4/attacks.mjs`
(twice; expected nonzero on the refutation); `node evidence/e5-t25a/verifier-r4/static-audit.mjs`;
`node evidence/e5-t25a/verifier-r4/release-audit-sabotage.mjs`;
`node evidence/e5-t25a/verifier-r4/integrity-audit.mjs`; exact diff/source inspection;
SHA-256 recomputation and visual inspection of both PNGs.
