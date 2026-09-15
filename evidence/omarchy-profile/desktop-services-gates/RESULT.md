# T03l pre-browser gates

Changed boundary: authoritative page-owned guest identity, Omarchy IDE-service
isolation and lazy agent activation. No Rust, guest image, renderer, clocks,
JIT policy or acceptance deadline changes.

- `node --test web/tests/omarchy-desktop-services.test.mjs`: 8 passed,
  `ide-final-r2.log`. The previous `ide-final.log` retains a fixture failure:
  save legitimately renders its initial progress before awaiting; the corrected
  test compares the render count before and after retirement instead of
  forbidding the initial CLI progress render.
- Agent session/bridge/restore/clipboard, readiness, geometry, viewport, pointer,
  boot path and startup-state tests: 58 passed, `browser-boundaries-final.log`.
- Recorder, input trial, owned-process watchdog and live-server harness tests:
  33 passed, `recorder-r2.log`.
- `make web-dist`: passed, `build-final.log`. Source `main.js`, `ide.js` and
  `desktop-agent-session.js` compare byte-for-byte with the built bundle.
- Unchanged built WASM SHA-256:
  `9405d6c38be9a170ef5a2e5e0bacdcbec6deace7de48c8e002bc3caea76dfb2b`.
- Syntax, scoped diff checks and task policy passed. Only T03l is active.

Daybreak independently found two retirement races, now fixed and covered:
pending log refresh must recheck ownership before creating its stream, and a
retired boot's error callback must not overwrite the new owner. It also
requested the new catalog/probe/snapshot/action callback coverage. These checks
are host/lifecycle tests, not a guest boot or responsive-desktop claim.

Actual built ISA, BusyBox Explorer/RPC and the one R3 desktop recording follow
the frozen commit. The CLI recorder additionally checks the actual session,
completed Explorer tree and served IDE/agent-helper identities. No production
deployment or completed usability claim is made here.

## Evidence-only corrections after source freeze

The built ISA run passed127/0 with no page/console/HTTP errors. The actual
`demo/demo-suite.png` was opened and inspected; the live task entry correctly
remains in progress. Runtime source/dist is frozen at `ed550aa8`.

Daybreak found the action fixture lacked `shq` and never entered its deferred
guest command. The fixture now supplies it and asserts command entry before
retirement/settlement; all8 tests pass in `ide-final-r3.log`. This supersedes
the action-completion coverage claim in the earlier passing run.

The first CLI attempt aborted in Node24's HTTP parser during the server
readiness GET (`cli.log`), before Chrome or the guest started and before a
report could be written. The headers-only readiness probe now uses HEAD to
avoid leaving the HTML response body unread. The failed attempt is retained;
rerun in a new directory. No runtime or acceptance deadline changed.

The action fixture's successful resolution subsequently fell through absent
success-path helpers. It now awaits an explicit command-entry barrier and
rejects the pending command deliberately after retirement. `ide-final-r4.log`
passes8/8 and proves the intended stale-error/finally boundary without relying
on an accidental fixture exception. Runtime and dist remain unchanged.

`cli-r2/report.json` records a real18-second boot failure, not an Explorer
failure: `Linux worker heartbeat timed out after301ms`. The existing recorder
URL enabled `testHooks`, which `main.js` uses to install this artificial300ms
watchdog. The public CLI APIs require no test hooks. The recorder now uses
`?noAutoBoot=1#ide`, with normal production watchdog settings and the same
five-minute whole-run limit. This does not change application timeouts.

The failure report and actual full-page screenshot were saved before recorder
cleanup hung. Killing bash alone left its descendant pipes open; the harness
now owns/terminates the server process group with a five-second cleanup bound.
The stale recorder60766 had no remaining browser/child and was terminated;
its failure files remain intact. The next attempt uses a fresh directory.
