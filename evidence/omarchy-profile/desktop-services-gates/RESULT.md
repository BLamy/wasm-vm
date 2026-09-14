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
