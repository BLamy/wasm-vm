# E5-T25a verifier preregistration

Verifier identity: Daybreak Blue. Frozen publication head:
`fc7bfdf5e6aa503e853ab85e48d4ea656dbede77`; implementation commit:
`2fd093b2181b5fdcfe2e2e41b61f3b60d4fc9edb`; activation base: `32aedf8c`.

These predictions were recorded after reading AGENTS.md, the complete task, and the
task diff, but before inspecting the retained evidence payloads or running the
acceptance/attack observations.

- P1 exact-head gate: `make verify-E5-T25a` exits zero at the frozen head and its
  transcript identifies Node tests, release audit, Chromium 152, and Firefox 132.
- P2 deterministic fixture: each of five independently constructed adapters emits
  sequences 1..5 for move, press, release, key-down, key-up; tablet/keyboard calls
  occur before their matching sync; each complete serialized repetition is byte-equal.
- P3 drawn telemetry: a 2x2 RGBA damage present produces one record with rect
  `{x:0,y:0,width:2,height:2}`, 16 bytes, `drawn:true`, and drawn counters 1/16.
  An acknowledging null backend produces `successfulPresents:1` but record
  `drawn:false` and drawn counters 0/0.
- P4 state attacks: stale release, duplicate press, and duplicate release are explicit
  no-op records with unique monotonic sequence numbers and no controller calls; the
  next valid transition emits exactly once with the next sequence. Pointer and key
  state remain independent.
- P5 damage attack: an out-of-resource rectangle is rejected before backend/telemetry
  accounting and a following valid present records sequence 1 and intact counters.
- P6 sequence surface: no public helper accepts or mutates a caller-provided sequence;
  records from one adapter are strictly increasing and cannot duplicate even across
  rejected/no-op inputs.
- P7 release isolation: normal source and committed `web/dist` pages neither import
  the helper nor expose `window.__desktopPerf`; only the explicit conjunction of
  `testHooks` and `perfHooks` gates the diagnostic surface. Gated Chromium and Firefox
  expose the helper-facing record while normal queries do not.
- P8 artifact evidence: recomputed SHA-256 values match all four worker-cited JSON/PNG
  hashes; retained browser JSON names Chromium 152.0.7977.76 and Firefox 132.0 and the
  retained demo JSON reports 126/126 with no browser or HTTP errors.
- P9 schema parity: a canonical fixture record serialized independently in Node and in
  each actual browser has exactly identical UTF-8 JSON bytes, including field order,
  field names, values, and absence/presence semantics; a shared version label alone is
  insufficient.
- P10 changed-hunk coverage: every behavioral hunk from `32aedf8c..HEAD` is exercised
  by the acceptance run, retained built-page proof, or bounded attacks. Any remaining
  line is only generated parity, declarations, or a defensive catch/default and will
  be waived with a specific reason; otherwise verdict is needs-evidence/dead.
- P11 bounded novel ordering attack: two helper methods invoked without awaiting the
  first still deliver complete controller frames in record-sequence order; no event
  from sequence 2 appears before sequence 1's sync. An async API that assigns sequences
  but permits the underlying evdev frames to interleave does not meet deterministic
  ordering.
