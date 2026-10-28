I’ll perform the requested independent diagnostic only. I’ll first record falsifiable predictions, then inspect `AGENTS.md`, the T24 task, the scoped diff, harness sources, and preserved v2/v3/v4 evidence without touching the live process or repository state; my only output file will be the specified `/private/tmp/.../diagnostic.md`.

Predictions recorded before opening preserved run evidence:

- P1: v3’s >4 GiB Node failure should be attributable to the Playwright protocol serializing a ~27.9 MiB native `Uint8Array` as indexed numeric JSON, not to the retained session export itself. The fix is sufficient only if every large native-state return now crosses as one bounded base64 string and the exposed callback returns small metadata.
- P2: the base64 conversion may still have a browser-side transient-memory risk if it uses an unbounded spread, whole-array numeric expansion, or retains duplicate encodings across checkpoints; chunked conversion plus a hard encoded-size ceiling would refute that risk.
- P3: the UI proof may be insufficient even if memory is fixed: “fresh-profile import/reload/seek/step/native capture” must be exercised through the shipped visible UI, with a genuinely separate browser storage profile/context and state equality checked after reload—not merely direct module calls in one page.
- P4: the bounded GPU proof must traverse shipped UI/controller behavior and demonstrate paged/delta replay plus physical-renderer witnesses; a bespoke proof page calling low-level APIs directly would leave the capstone’s UI integration criterion uncovered.

I’ll now trace each prediction to exact source lines, then test it against immutable v2/v3 evidence and read-only v4 progress.

The preserved failures support P1 so far: v2 failed only on the default 30-second download waiter; v3 then produced a 153,218,100-byte archive and reached the native-state readback before Node’s V8 heap hit ~4.09 GiB. The old harness returned `[...bytes]` from `page.evaluate`, while the current code sends chunk-built base64 to an exposed callback with a 48 MiB encoded ceiling and compares all decoded bytes. I’m checking whether that bounded route is actually the one exercised and whether the UI coverage has a separate sufficiency gap.

A concrete sufficiency gap remains independent of the live gate’s outcome: the harness’s “middle seek” calls the controller directly and only checks the UI digest against the same controller-produced digest. It never compares that middle digest to the immutable recording’s known checkpoint digest, and its forward step checks only `transition + 1`, not CPU/RAM/device/disk state. This affects both software and GPU cases. The preserved recordings already contain independent expected middle checkpoint digests, so the narrow remedy is a session-UI-only replay using those immutable inputs and the visible seek/keyframe control—no boot, recording, or performance rerun.

READINESS: needs-evidence

Concrete gap: middle seek/step state is self-validated rather than compared with immutable recording witnesses. The base64 fix does cover v3’s numeric-array OOM path, but v4 remains running.

Diagnostic: [diagnostic.md](/private/tmp/e9-t24-daybreak-ui-audit-v1/diagnostic.md)

Not final acceptance; no task marked verified.
