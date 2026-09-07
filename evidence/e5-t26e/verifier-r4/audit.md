# E5-T26e remediation 3 changed-hunk audit

Diff audited: `ec9517ea53d62b19f908379f9a79519c282983ee..ea14c48f12a323ff60fb21744a34c10e814cd68a`.

- `crates/core/src/desktop_restore.rs`: early cold reset and backend cold fallback execute in the
  exact gate and the independent missing-component/dirty-state attacks. Covered.
- `crates/core/src/dev/virtio/console.rs`: field initialization, transport/application readiness,
  mark/consume, host disconnect, restart, and device reset execute across the exact gate, full
  five-test console module, and independent public-API attack crate. Covered. The u64 wrap-to-zero
  repair branch in `mark_application_hello` is waived as a defensive overflow guard requiring
  2^64 accepted HELLOs; its postcondition is directly visible in source.
- `crates/core/src/lib.rs`: GPU/input/sound/agent early refusals, shared fallback, live backend
  construction, successful coordinator call, host state read, and HELLO confirmation execute in
  the exact gate and six independent attacks. The clean-device snapshot-construction error arm is
  waived as an invariant guard: the newly constructed power-on codecs are deterministic and their
  encode paths are covered by component gates.
- `crates/core/tests/virtio_console.rs`: success and dirty-sink/missing-agent regressions execute in
  `make verify-E5-T26e`. Covered.
- `crates/wasm/src/lib.rs`: wasm32 compile only. The exported method bodies are exercised through
  generated-bindgen shape/source checks but not a live wasm instance; acceptable only together
  with a green worker/page composition test. Currently needs evidence because that test is red.
- `web/agent-channel.js` and its test: the fresh transport generation, old transport close, peer
  HELLO wait, and result generation execute in both submitted and independent Node runs. Covered.
- `web/desktop-restore.js`: success, application confirmation refusal, RPC refusal, mismatched
  viewport, real PresentationController resize/clear, and canvas-style callback execute across the
  focused tests and verifier attack. Covered.
- `web/linux-worker-protocol.js`: the allow-list, byte-argument ownership, and long-RPC entry compile
  and parse. The repository's exhaustive all-method worker test fails before dispatch because its
  fake controller omits the two new methods. **Needs evidence / regression.**
- `web/loader.js`: method closures parse and generated source matches dist. Their production worker
  dispatch is not exercised because of the red all-method test. **Needs evidence.**
- `web/main.js`: source establishes that `window.__desktopRestore` closes over the actual retained
  `presentation`, `displayViewport`, and current `linuxCtl`; the bridge is independently executed
  with the real T22 controller. Full live-page invocation is reserved for T26f's browser round
  trip. Covered with that scope waiver.
- `web/tests/*.mjs`: submitted focused tests execute and pass. The untouched but directly impacted
  `e4-t32-worker-protocol.test.mjs` fails and must be repaired as part of this RPC-surface change.
- `web/dist/*`, bindgen JS/TS, wasm binary, and service-worker digest: generated projection.
  Source/dist parity, wasm32 wrapper check, and exact committed blob identity hold; waived from
  line execution as generated artifacts.
