# E5-T25a verifier-r5 preregistration

Frozen worker head: `57c2cc828c151c830ebd7a377dc29d7bf898566d`.

These predictions were written after reading the complete task and the r2/r3/r4 verifier
reports, but before inspecting the worker fix diff or running semantic attacks.

1. **Attribution failures remain diagnostic-only.** In source and committed dist, a
   callback throwing a normal `Error`, an object-form sample whose
   `retiredInstructions` getter throws, and a callback throwing an object whose
   `message` getter throws will each emit an explicit `null/null` attribution record,
   preserve the prior baseline, keep successful/drawn counters advanced, return true
   from `present()`, leave `droppedFrames` at zero, and append a safe diagnostic. A
   null `retiredInstructions` value followed by a throwing `guestInstructions` getter
   will have the same contained outcome.
2. **Attribution validation does not coerce.** Invalid scalar and object-form values,
   including coercible strings/objects, booleans, boxed numbers, unsafe integers,
   non-finite values, and negatives, will emit `null/null` and leave the baseline
   unchanged. Subsequent valid totals 100 and 175 will emit respectively
   `(guestInstructions, guestInstructionsTotal)=(100,100)` and `(75,175)`.
3. **Parity and bounded release proof hold.** `web/main.js` and its dist copy,
   `web/src/sink/presentation.js` and its dist copy, and helper JS/TS projections will
   be byte-identical. The release audit will locate lifecycle requirements inside exact
   bounded scheduler/sampler/surface/teardown blocks; independent mutations of the dual
   gate, strict guard, sampler setup, timer cleanup, and baseline reset will each make
   it fail. Exact query isolation will be false/false/false/true, and owner teardown
   will clear and null the timer and reset the attribution cache.
4. **Exact gate and retained artifacts hold.** `make verify-E5-T25a` will pass syntax,
   ten focused tests, the release audit, Chromium 152, and Firefox 132 unless localhost
   binding is rejected with `EPERM`. If so, only that browser execution leg will rely
   on exact-head retained artifacts. Their hashes will recompute, the demo JSON will
   report 126 passed/126 done/0 failed with empty browser and HTTP error arrays, and the
   worker log will retain the full PNG digest
   `7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`
   plus demo digests
   `0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd`
   and `aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1`.
5. **Prior held behavior remains intact.** Concurrent operations will remain whole and
   ordered through sync; a rejected queued operation will not poison later operations;
   stale/duplicate transitions will be exact no-ops; invalid damage will not corrupt
   the next valid present; the null sink will report no drawn work; five fixture records
   will be byte-stable; release surfaces and source/dist schemas will remain isolated
   and equal.
6. **Novel hostile diagnostic attack.** Throwing a revoked proxy from the attribution
   callback will not escape either diagnostic property access or string conversion.
   It will emit `null/null`, preserve the previous baseline, retain a successful drawn
   present with zero drops, and append a safe fallback diagnostic in source and dist.
7. **Coverage.** Every changed runtime/test/audit hunk from the task implementation and
   rework chain will be dynamically exercised, or receive a precise static/generated/
   declarative waiver tied to its role. No task-mentioned runtime hunk will remain
   unexecuted and no dead hunk will remain.
