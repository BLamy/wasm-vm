VERDICT: verified

E6-T11c survives independent falsification within its stated retained-scanout
profile. All S01–S22 predictions are HELD; the per-prediction evidence points are
in `observations.md`. This verifier did not implement or modify runtime code.
The immutable predictions predate implementation, SHA-256
`274196136e3bf17fa5c8a3f9e190dc29b99ede19d39c276fd4d2f2c6afd7d982`;
the literal pixel oracle remains
`0d459281117404313b0e3916c963217a1ca7c9cb46fc8efcc0ea7228543ac994`.

- **Retained snapshot and global identity — HELD.** Predicted an issued frame A
  survives an actual GPU write B, context destruction, public unref and numeric-ID
  reuse without redirecting to the replacement. Own `attacks.json:257,727,1197`
  records A across readiness delays 2/5/9 while ordinary mutable read tickets
  reject the new content revision. `:1660` retains the accepted old generation;
  `:1690` paints the new 2x3 blue texture only after a new binding. No correction
  demanded; keep the literal tests.
- **Guest completion versus actual presentation — HELD.** Predicted successful
  FLUSH may leave pending=1, drawn=0 and one retained frame until the real draw or
  retirement. The own snapshot records bind these counters to actual GL work and
  canvas bytes; `:1912` exercises supersession, disable/reset and stale callbacks.
  `:2778` switches 3D→borrowed 2D→3D across Wasm memory growth. Live pixels were
  visually inspected in `attack-live.png` before teardown. No claim of physical
  display completion follows from enqueue acceptance.
- **Strict queue/authority and failure behavior — HELD.** Own `attacks.json:2157`
  checks literal malformed requests and complete writable-response preflight;
  `:2628–2650` rejects context DMA and draw/command authority for global capture,
  and a late completion after reset. `:3053` checks feature-off/short/invalid-2D
  routes; `:3143–3166` checks uncertain transport failure and reset. Full fence
  bytes, native/Wasm canonical parity and unchanged B2 ordering remain held.
- **Independent GPU and canvas oracle sensitivity — HELD.** Own baseline records
  3,118 assertions, 303 records and 93 browser turns, zero GL lifetime violations,
  native counters zero after cleanup and zero console/page/request errors.
  Independent literal Y/channel/alpha values match actual built canvas pixels.
  Served-source controls each fail the intended assertion at report line 254:
  `orientation.json` (pixel byte 1), `early-readback.json` (CPU collection before
  matching signal), and `stale-delivery.json` (old 3D callback paints pending 2D).
  No product source file was changed for those controls.
- **Coverage and dependencies — HELD with explicit narrow waivers.** The final
  instrumented native replay passes 17 tests: six worker scanout tests, nine prior
  submission tests, two independent trait-default/canonical-authority tests.
  `coverage-census.json` binds LLVM objects/profiles and V8 ranges to the actual
  diff; `coverage-review.md` accounts for every changed runtime/harness hunk and
  lists exact private invariant/host-diagnostic/type waivers. Unchanged decoder,
  state, controller and B2 behavior carry prior HELD results with source hashes
  and same-source regression evidence. No acceptance behavior is waived.
- **Cold clone and ordinary desktop — HELD.** `audit.json` passes 3,524 independent
  binding/assertion checks, including actual files, served bytes, 12 native/Wasm
  records, explicit image/kernel/manifest/chunks, release and own source hashes.
  Final cold `85962c4956bad75c7703767650b49763fb0e5945` passes the complete gate
  with clean Git status before/after and unchanged inputs. Its desktop has 28
  drawn frames at 215,521ms with every error array empty, a normally completed
  kernel request, and an independently viewed screenshot. Ordinary local/live
  demo remains 127/127, exact default Wasm bytes and all three proof exports absent.

The reviewed runtime diff is
`ab5f3a85cbf25dd151b6ae74904dd5e1fc793820..f1aeb2538d1fda62eef7c127925ac043973f8f4a`.
Worker submission is `ad88508e3068aa8d52298751b663133a0c0b8583`.
The two later source changes are bounded harness repairs: `fbceeb4d` substitutes
streaming SHA for unavailable Python 3.9 `hashlib.file_digest`, with a strict
receipt-only historical-head validator; `85962c49` changes only the immutable
kernel test response to no-cache and adds passive correlated network metadata.
They change no renderer, emulator, presentation, release or guest fixture bytes.

The first cold clone remains **failed**, not retrospectively accepted. Its lone
kernel ERR_ABORTED was investigated using the same loader/browser/kernel: 12/12
consumers obtained exact EOF/bytes/SHA, four no-store requests reported false
aborts and no no-cache controls failed. `audit-network.py`, `network-audit.json`
and `cold-observation.md` retain independent attribution and the final closure.
Strict failed-request rejection, cache-disable, fresh contexts and blocked service
workers remain enabled. This observed harness/environment isolation failure
justifies the additional final pristine clone under incremental verification.

Own calibration is also retained: the first harness incorrectly equated a live
signaled retained ticket with incomplete GPU work; final checks distinguish actual
post-signal collection from deferred frame retirement. Initial verifier native
resolution selected five newer transitive versions; the final lock now matches
the frozen workspace and the 17-test coverage run was repeated with `--locked`.
Neither correction changed product code or worker evidence.

Replay commands, from the repository root after the task's build prerequisites:

```sh
node evidence/virgl-scanout/verifier/run-attacks.mjs baseline
node evidence/virgl-scanout/verifier/run-attacks.mjs orientation
node evidence/virgl-scanout/verifier/run-attacks.mjs early-readback
node evidence/virgl-scanout/verifier/run-attacks.mjs stale-delivery
CARGO_TARGET_DIR=target/virgl-scanout-verifier-native \
RUSTFLAGS='-C instrument-coverage' \
LLVM_PROFILE_FILE="$PWD/target/virgl-scanout-verifier-native/%p-%m.profraw" \
cargo test --locked --manifest-path evidence/virgl-scanout/verifier/native/Cargo.toml -- --nocapture
python3 evidence/virgl-scanout/verifier/coverage-audit.py
python3 evidence/virgl-scanout/verifier/audit-network.py
python3 evidence/virgl-scanout/verifier/audit-evidence.py
```

For a fresh coverage replay, capture native output to `native-run.log` and keep old
profiles separate from new ones, as recorded here. Compiled outputs and raw
profiles remain under ignored `target/`; committed evidence contains sources,
recordings, coverage exports and hashes only. The main verify target supplies the
hardware Wasm/shader build; the independent runner uses ordinary headed Chrome
with hardware WebGL2 and no software-GPU override.

SHA-256 anchors:

- Own `attacks.json`: `e48f659aaa8b45ab5c50272caa11fb66153c4ffd3fbcf2783728dbebe5995284`.
- Own `audit.json`: `9b2ede7897732dd12e3475fc00d216bc7aa80d63b593f956e872176b4a6deee9`.
- Own `coverage-census.json`: `0d3aeb58b6c52bbf8d9c825bb7b0b4a1f8e447839240a99210ac2771f26d0db0`.
- Worker receipt: `ad5f1dcc3fa2b9cd606277c9ca29d0a47dd169acc64223e64a49293d4cdfaca3`.
- Final cold report: `d99c7d98cd1dee7e34b70c38b7ff480c8718806f5787c98ec96b76bb32f0da3e`.
- Final cold receipt: `84c6d8af8e691fc82f0d0778ab6e9a3e73b98750ef74c1d004c8075747552352`.

SUITE: retain verifier wire/GL/pixel oracles, literal attacks, three controlled
source omissions, native independent cases and hash/coverage audits as replayable
regression evidence alongside `make verify-E6-T11c`. Scope remains a bounded
retained GPU-backed fixture and preserved ordinary 2D boot. Production VIRGL is
disabled; live Mesa, compositor acceleration, FPS improvements and zero-copy are
not verified by this task.
