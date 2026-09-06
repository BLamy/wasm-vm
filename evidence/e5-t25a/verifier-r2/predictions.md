VERIFIER PREDICTIONS — frozen before inspecting verifier-r2/fresh-browser artifacts

Exact reviewed publication head: `0da96f6a5c7f323b986fe41b6f6bfb2508eec834`.
Reviewed semantic range: `47b489e8a86351994a6399bbfe8691979d0c7c5b..HEAD`.

1. Exact gate. The retained `fresh-browser` transcript will identify the exact head,
   show eight focused tests passing with no skip/ignore/panic, a successful release
   audit, and successful real Chromium 152.0.7977.76 and Firefox 132.0 checks. Each
   engine's normal page will report `normalSurface=false`; the both-gates page will
   report `gatedSurface=true` and a complete move frame ending in `syncTablet`.
2. Reworked ordering. In at least 64 independently delayed concurrent
   `Promise.all([moveAbsolute, leftButton])` trials, each result will receive a unique
   increasing sequence and the controller call ledger will be exactly one of the two
   legal whole-frame orders: X, Y, tablet-sync, button, tablet-sync (move queued first)
   or button, tablet-sync, X, Y, tablet-sync (button queued first). No next operation
   call will appear before the prior operation's sync. A rejected controller operation
   will not permanently poison the queue; the next valid operation will run with a
   fresh, unique sequence.
3. Guest attribution. With deterministic retired totals 100 then 175, two successful
   presents will record respectively
   `(guestInstructionsTotal, guestInstructions)=(100,100)` and `(175,75)` in both
   source and committed-dist presentation controllers. Missing, throwing, invalid, or
   decreasing samplers will yield explicit null attribution without forging a positive
   delta or corrupting the next valid sample.
4. Fixture stability/schema parity. Five repetitions of the documented move,
   press/release, key-down/key-up, and drawn damage sequence will serialize to identical
   bytes. JavaScript and TypeScript fixture adapters will be byte-identical, and source,
   dist, native-Node, Chromium, and Firefox fixture records will retain the same
   `e5-t25a-v1` public event schema and ordering.
5. Null and damage attacks. An acknowledging non-drawing sink will report one successful
   present but `drawnPresents=0`, `drawnBytes=0`, and a telemetry record with
   `drawn=false`. An out-of-resource rectangle will throw before mutating presentation
   counters/ledger; the next valid exact 2x2 rectangle will be sequence 1, 16 bytes,
   and drawn once.
6. Input state/sequence attacks. Release-without-press, duplicate press/release, and
   duplicate key-down/key-up will be explicit no-ops with empty event arrays. Every
   accepted or no-op public operation will get one unique monotonically increasing
   sequence; rejected synchronous validation will allocate none and will not corrupt
   the next valid event.
7. Release isolation. Normal, `testHooks`-only, and `perfHooks`-only source and committed
   dist pages will expose no `window.__desktopPerf`, will not request/import the helper,
   and will not install the 50 ms scheduler-retired sampler. Only both query gates will
   install attribution sampling and expose the test surface. The release audit will
   report no production import/page surface and the expected hook version.
8. Worker evidence integrity/demo. All worker-cited JSON/PNG SHA-256 values will
   recompute. The refreshed stored demo JSON will report 126 passed, 0 failed, 126 done,
   an empty `errors` array and empty `httpErrors`; its only resource error may be the
   explicitly waived favicon 404.
9. Diff coverage. Behavioral helper queue/state lines, attribution parsing/delta/record
   lines, gated page sampler/timer/cleanup lines, and new tests will be exercised by the
   exact gate plus independent attacks/surface audit. JS/TS and source/dist projections
   may be waived only after byte comparison; Makefile/task/demo changes are declarative
   evidence; the 4096 cap and genuinely defensive exception branches require an explicit
   waiver if not executed. No changed runtime hunk may remain unexplained.
10. Novel bounded attack. A mixed concurrent burst spanning tablet move/button and
    keyboard down/up, with deterministic per-call delays, will retain complete evdev
    frames and unique public sequences, and a deliberately rejected queued call will
    not block the subsequent valid frame.

Verdict rule: any product contradiction is `refuted`; a required behavior left
unexercised is `needs-evidence`; otherwise the task is `verified`.
