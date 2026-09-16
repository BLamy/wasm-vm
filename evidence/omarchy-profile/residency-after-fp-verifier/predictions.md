# T03ab independent verifier predictions

Written 2026-09-16T01:45:18Z, before either physical arm. Initial task head is
`fd6bd943`; verified parent is `0879464ea33b02c86371a3098abe6311e25f4067`.
Read the entire task, AGENTS.md, T03aa/T03z acceptance and verdicts, existing
input-trial/driver timing path, and the production residency selector before
writing these predictions. The worker's harness extension is still pending.
No browser is launched by this critic. These predict acceptance invariants,
not candidate efficacy.

- **R1 — fixed experiment selection.** The default recycling experiment will
  retain its existing control=false/candidate=true recycling behavior and
  repack-off cap 24. The explicit local residency experiment will accept only
  its fixed control/candidate choices: repack-off cap 24 versus cap-256 cap
  256, both recycling=false. Unsupported experiments, arbitrary caps and
  contaminated option/URL selections will be rejected before input. Tests
  will exercise the actual option, URL and runtime-validation functions.
- **R2 — one runtime difference.** Both actual pre-input and available final
  runtime samples will select their declared cap and keep recycling off,
  threshold 512, tracking capacity 65,536, decoded cache 4096, admission probe
  and timing off, icount divider 64 and 1280x800 display. LP1 is inherited
  from the pinned R3 pair. Source and artifact audit will show the existing
  selector changes only `budget.max_batches`; code-byte, table-slot and
  metadata budgets, translator, eviction policy and defaults are unchanged.
  No new instrumentation is required to carry that unchanged source proof.
- **R3 — identity and evidence continuity.** Reports will bind both arms to
  one committed source head, their exact recorder, clean scoped runtime,
  unchanged R3 kernel/snapshot/delta/base bytes and WASM SHA-256
  `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`.
  Prior T03z cold/deployment and unchanged semantic proof will carry only
  after independently checking matching source and evidence digests. The
  previous T03aa failures and September 10 cap-256 diagnostic stay recorded.
- **R4 — one owned, bounded pair.** Exactly one control will finish before
  one candidate starts, each in a fresh Chrome process/context. The batch
  will scrub inherited experiment options and confirm normal browser and
  recorder closure before continuing. No watchdog, retry, repeated arm,
  policy sweep, deadline extension or late result will count as acceptance.
- **R5 — actual readiness and physical input.** Any arm that types will
  first show restored=true, the app's real layers-plus-pixels readiness,
  visible desktop capture and canvas focus within one navigation-anchored
  300,000 ms startup allowance. Recorder-only clients/activewindow queries
  remain omitted. The independently generated nonce and guest filename
  reconstruct the exact trusted, nonrepeat, focused DOM key down/up events
  and ordered keyboard/sync calls with matching acknowledgements. An arm
  that never qualifies is startup-inconclusive, not an input failure.
- **R6 — independent nonce and original deadlines.** Typing including
  focus checks finishes within 60,000 ms; Enter completion anchors exactly
  120,000 ms for all subsequent focus and readback work. Raw guest response
  fences must contain exactly the independently expected nonce with exit 0
  before that deadline to pass. Command echoes, host acknowledgements,
  serial writes, stale/wrong/future/incomplete replies or exit 75 do not
  pass. Pending or failed readbacks remain represented in the raw evidence.
- **R7 — genuine visible result.** A positive result additionally requires
  a fresh guest presentation and a personally inspected actual screenshot
  with the typed terminal command/response. Capture and cleanup retain
  20,000/30,000 ms bounds. Empty or unchanged Foot, no nonce, or frames 2->2
  fails responsiveness regardless of installs, refusals, JIT share or
  startup duration. Neither one pair nor PC-recurrence counters prove a
  speedup or a stall cause; batch evictions are not block evictions.
- **R8 — coverage and bounded novel attack.** The final diff will be limited
  to the fixed proof harness, its focused tests and experiment evidence and
  metadata. Both actual option paths plus focused recorder/adapter tests
  must cover the changed behavior. One independent offline attack on a
  copied or in-memory report will preserve a purported successful receipt
  while altering a selected residency/runtime invariant or removing timely
  nonce evidence; the audit must reject it. This launches no extra arm and
  changes no runtime. The verdict certifies the honest bounded experiment;
  only genuine R5-R7 success could support a separately proven T03q remedy.

Initial selector anchors: `crates/wasm/src/lib.rs:503-544` validates the
existing policy then changes only `budget.max_batches`;
`crates/wasm/src/jit_browser.rs:1255-1257` obtains other budgets from
`JitCacheBudget::DEFAULT`. Existing timing/readiness/input anchors are in
`tools/verify/omarchy-desktop-live.mjs:1079-1238`. Line numbers will be checked
again against the frozen final diff. Later observations will be recorded as
HELD, FAILED or NEEDS EVIDENCE without changing these predictions.
