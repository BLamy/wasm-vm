# E5-T25a verifier-r4 preregistration

Verifier identity: fresh pass four. Exact worker head:
`f7cee38b5aa93b00509e60d7dd103f5e5c21bfe3`; implementation hardening:
`ee4879a3430e5ac387dc7a960c6033d625860aeb`; prior verifier refutation:
`ea18259c072be8cd4d20212fb5d0228b29d1a99b`.

These predictions were frozen after reading the complete task, the reviewed hardening
diff, and the three prior verifier reports, but before running pass-four tests or
inspecting fresh pass-four observations.

1. Attribution validity and recovery. Scalar null, undefined, strings, booleans,
   boxed values, `NaN`, infinities, negative values, and unsafe integers, plus the same
   invalid values in supported `retiredInstructions` and `guestInstructions` object
   forms, will emit `guestInstructions:null` and `guestInstructionsTotal:null` without
   advancing the baseline. Subsequent totals 100 and 175 will emit 100/100 and 75/175.
2. Exception containment. A callback throwing an ordinary `Error` and an object-form
   `retiredInstructions` getter throwing an ordinary `Error` will each leave a backend
   draw successful: `present()` true, one successful/drawn present, zero dropped frames,
   a null/null attribution record, preserved baseline, and a diagnostic error. This will
   hold in both source and committed dist.
3. Byte and release parity. Source/dist `main.js` and presentation files, and helper
   JS/TS files, will be byte-identical. The exact dual-query declaration will occur once;
   the scheduler cache assignment will be owned by a raw strict-number/safe/non-negative
   guard; sampler creation will be confined to the exact dual-gated owner block; and
   teardown will clear and null the timer and reset the baseline.
4. Bounded release audit. The updated release audit will derive explicit scheduler,
   sampler, surface, and teardown blocks and assert lifecycle properties inside those
   bounded blocks. Deterministic sabotage of the strict cache guard, dual gate, sampler
   ownership/setup, timer nulling, or baseline reset will make the audit fail.
5. Exact gate and browser artifacts. `make verify-E5-T25a` at the frozen head will pass
   syntax checks, exactly nine focused tests with no failures/skips/todos/cancellations,
   the release audit, Chromium 152.0.7977.76, and Firefox 132.0 if localhost binding is
   permitted. If binding is denied, the non-browser legs will pass and retained exact-head
   browser artifacts will independently prove both engines and source/dist behavior.
6. Prior attacks. Delayed concurrent operations in both call orders will retain complete
   frames through sync; a rejected queued operation will release the queue; stale and
   duplicate events will be explicit no-ops with unique sequences; invalid damage will
   not corrupt the next valid present; a null sink will not claim a draw; five records
   will be byte-stable; source/dist schemas will match; and normal/half/full release
   queries will isolate the surface as false/false/false/true.
7. Novel hostile attribution. Two bounded variants will not turn a completed draw into a
   drop or poison the baseline: (a) `retiredInstructions` is nullish and the fallback
   `guestInstructions` getter throws, and (b) the callback throws an object whose
   `message` accessor itself throws. Each must produce null/null, a successful drawn
   present, zero dropped frames, and a diagnostic, followed by 100/100 and 75/175.
8. Evidence integrity/demo. The worker log will contain the full browser PNG digest
   `7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`.
   The current demo JSON and PNG will hash to
   `0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd`
   and `aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1`,
   and the demo will report 126/126 with empty browser and HTTP error arrays.
9. Coverage. The getter catch and promoted regression will execute dynamically. Source/
   dist copies will be accepted only with byte parity plus direct execution where
   practical. The lifecycle audit must execute and its bounded assertions must survive
   sabotage. Main sampler/cache/teardown lines may receive only an exact deterministic
   static waiver if localhost/browser boot remains unavailable. Every changed hunk in
   `ea18259c..f7cee38b` must be executed, precisely waived, declarative, or dead.

Verdict rule: a semantic contradiction is `refuted`; an otherwise uncontradicted claim
with missing required evidence is `needs-evidence`; only complete correctness and
coverage permit `verified`.
