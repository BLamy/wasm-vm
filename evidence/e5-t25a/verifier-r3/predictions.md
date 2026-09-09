# E5-T25a verifier-r3 preregistration

Verifier identity: Daybreak Blue, third pass. Exact worker head:
`a1c25437bed33910218eece228a77b230abfb8e9`; implementation fix:
`368feb2974b9f438fda2c6f4ea751fc31c594d21`; prior verifier head:
`568159e176c52774f72b16eb26b0077fb7b68fee`.

These predictions were frozen after reading the complete task, the full reviewed diff,
and both prior verifier reports, but before running pass-three tests or inspecting fresh
pass-three observations.

1. Unavailable attribution. For scalar and object-shaped sink callbacks, null,
   undefined, strings, booleans, unsafe/non-finite/negative numbers, malformed objects,
   and callback errors will emit `guestInstructions:null` and
   `guestInstructionsTotal:null`. None will advance the baseline. Subsequent totals 100
   and 175 will emit 100/100 and 75/175. Decreasing totals will be unavailable and will
   not replace the last valid baseline.
2. Source/dist and cache behavior. `web/main.js` and `web/dist/main.js`, plus source and
   dist presentation helpers, will be byte-identical. The scheduler cache will accept
   only non-negative safe JavaScript numbers and reject null, undefined, strings,
   booleans, unsafe/non-finite/negative values, and malformed objects.
3. Lifecycle/isolation. The sampler callback and 50 ms timer will exist only under the
   conjunction of `testHooks` and `perfHooks`. Owner teardown will clear the interval,
   null its handle, clear the exported scheduler accessor, and reset the cached guest
   instruction total so a later owner cannot inherit stale attribution. Normal and each
   half-gated query will expose/install none of this surface.
4. Exact gate. `make verify-E5-T25a` at the frozen head will exit zero, run eight focused
   tests with no skip/todo/cancel/failure, pass the release audit, and complete real
   Chromium 152.0.7977.76 and Firefox 132.0 gated/normal checks if the environment permits
   the existing harness listener. The release audit regexes will be scoped tightly enough
   that sabotaging the relevant type guard, dual gate, timer setup, or teardown makes it
   fail rather than matching unrelated code.
5. Required held attacks. Delayed concurrent input calls will retain complete frame
   ordering; a rejected queued operation will release the queue; stale/duplicate events
   will be explicit no-ops with unique sequences; invalid damage will not corrupt the next
   valid present; a null sink will not claim a drawn frame; five fixture records will be
   stable; schemas and source/dist presentations will match; and no production hook
   surface will appear.
6. Novel invalid-attribution attack. Values crafted to exploit coercion or property
   selection, including `0`, `-0`, boxed numbers, numeric strings, booleans, `NaN`,
   infinities, unsafe integers, negative numbers, null-prototype objects, throwing
   getters, and conflicting object fields, will either obey the explicit numeric schema
   or remain null/null without poisoning the next 100/175 sequence. Zero as a real number
   remains valid; coercible non-numbers do not.
7. Evidence integrity/demo. The full browser PNG SHA-256 will recompute exactly as
   `7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`.
   The exact-head demo JSON and PNG will recompute as
   `0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd`
   and `aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1`,
   and the JSON will report 126/126 with no browser or HTTP errors.
8. Coverage. The sink null/type guard and baseline preservation will execute dynamically;
   the main cache guard, sampler setup, timer ownership, and teardown/reset will have
   deterministic execution evidence or a narrowly justified static-audit waiver. Every
   other changed implementation hunk in `568159e1..a1c25437` will be executed, generated-
   parity waived, declarative, or classified dead. Worker prose alone is not evidence.

Verdict rule: any semantic contradiction is `refuted`; any required behavior or changed
runtime hunk left without sufficient execution or a precise acceptable waiver is
`needs-evidence`; otherwise the task is `verified`.
