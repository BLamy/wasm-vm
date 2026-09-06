# E5-T25a changed-hunk coverage audit

- `Makefile:986-993`: executed by the exact acceptance replay.
- `web/bench/desktop-perf-hooks.js:14-91`: valid/invalid integers and booleans,
  controller validation, tablet/keyboard dispatch, sync, no-op, generic/left button,
  key, move, and monotonic sequence paths executed by Node/browser verifier fixtures.
- `web/bench/desktop-perf-hooks.ts`: generated editor projection; byte-identical to the
  executed JavaScript and waived as non-runtime.
- `web/src/sink/present-backend.js:13-18`: inherited default executed by real Canvas2D
  source/dist browser presents. The TS projection is waived as generated parity.
- `web/src/sink/presentation.js:135-139,315-345,393-395,461-463`: drawn true/false,
  backend without `drawsPixels`, inherited default, explicit/fallback clocks, replay,
  snapshots, actual source/dist callbacks, and null/OOB recovery executed. Callback
  exception handling is defensive and waived.
- `web/main.js:23-24,78-84,131-140`: normal, each half-gate, full gate, record push/copy,
  clear/state/controller methods, and source/dist presents executed. The 4096-entry
  shift is a defensive memory cap and the inaccessible-global catch is defensive; both
  are waived. `web/dist/main.js` and dist sink files byte-match source and were also
  exercised directly.
- `tools/verify/e5-t25a-release-audit.mjs`, `tools/verify/e5-t25a-browser.mjs`, and
  `web/tests/e5-t25a-perf-hooks.test.mjs`: all normal acceptance paths executed; server
  traversal/404, browser-error, and callback-error branches are defensive harness lines.
- Committed JSON/PNG evidence and task-log changes are declarative evidence. Their
  hashes were recomputed and screenshots inspected.
- Missing rather than merely uncovered: no changed or pre-existing task surface emits
  the required guest-instruction attribution. Separately, the executed async helper
  hunk permits cross-sequence evdev interleaving and is semantically refuted.
