# E9-T08 fresh verifier — predictions recorded before final evidence inspection

Date: 2026-10-18. Base: 65ef3082. Frozen implementation: 1b3c68c0def3fb98c8803ed6f95089f90ed7dfe7.
Scope: S / medium recorded built-browser integration over accepted T05/T06/T07. No continuous replay claim.
No final report, recorded trace, raw frame, profile, or screenshot was read before this file.

P0 — Exact identity and artifact authenticity.
The final `make verify-E9-T08` report will identify frozen implementation 1b3c68c0, have `development: false` in its browser report, all recorded commands exit 0, every retained source/report digest matches the bytes available for this run, and report `errors: []`. Original browser trace with original sources, screenshots, persistent profile, and original gzip checkpoint frames will be present. Runtime/store/library/loader/pinned GPU content must match the accepted base; this has already been confirmed by the scoped diff name list, before touching evidence.

P1 — Two fresh guests with divergent file, RAM, input and held-key state.
At the two pre-write guest command points, `test ! -e /root/e9-milestone/state` and unset `e9_memory` both succeed. Alpha and Beta have different session IDs, raw tuple hashes, RAM digests and actual same-path guest file bytes. Independent raw parsing must see keyboard [30] and [48] and queued input exactly `e9_queue=queued-alpha\n` / `e9_queue=queued-beta\n`; each manifest policy is checkpoints-only with zero continuous events. The native envelope must contain the sixteen expected sections and disk generation/image binding must match its attached disk component.

P2 — Exact restore across reload and a genuinely fresh tab.
Immediately after Open and before Resume, `beta-restored.checkpoint.gz` must be byte-for-byte equal to original Beta and `alpha-restored.checkpoint.gz` equal to original Alpha, across all components, input and held keys; paused must be true, scheduler slices 0, and active IDs/point IDs equal the selected original witnesses. The restored shell must independently return base64 of `beta-file\n` / `alpha-file\n` and RAM/consumed queued input `beta-memory/queued-beta` / `alpha-memory/queued-alpha`. Browser trace must show actual reload and new-tab navigation, visible Open actions and Resume before shell commands.

P3 — Quota preserves committed prefix and distinguishes unsaved state.
After Beta is mutated to `beta-unsaved\n`, lowering points to one and requesting another checkpoint must show visible `storage-error`/Recording paused, paused true and enabled retry. The stored Beta manifest/raw frame remains identical to its original. Unsaved active raw state must differ, with file bytes `beta-unsaved\n` and a different RAM digest. Stopping at prefix and raising the limit must not overwrite Beta's original point.

P4 — Rename/deletion preserve a different history durably.
Both visible names survive initial reload. Confirmed visible deletion of Alpha removes its session option. Beta's manifest and frame after delete remain original, and `beta-reopened.checkpoint.gz` after the next reload is byte-for-byte equal to original Beta. Its resumed shell again returns original file and RAM/queued values. Independent ext4 reconstruction/debugfs must see original Alpha, original Beta, unsaved Beta, reopened Beta bytes without relying on terminal screenshots or VM readback alone.

P5 — Reachable browser/UI/document result.
One suite finishes 127 passed / 0 failed. The touched roadmap pip is in-progress or verified at the frozen head. Keyboard Tab from name reaches Rename; controls fit a 390px viewport; screenshots visually show usable library controls. Rendered unified storage docs include Local saved checkpoints, the checkpoint-only limitation, quota/prefix/retry/deletion and same-origin limitations. Unexpected console/page errors stay empty through all pages.

N1 — Bounded independent attack, after submission readiness.
Clone (never modify) final Chromium profile. On the recorded local origin, open its surviving Beta through visible controls after reload, then rename Beta using a literal name containing markup-looking characters and Unicode. In an independently opened fresh tab the selected option/name must retain exactly that text, no injected element or errors appears, and opening the original Beta point must still be paused with a raw frame hash identical to original Beta before any resume. This attacks display metadata coupling to durable restore state and fresh-tab rehydration, beyond the worker's simple names. Preserve the attack recording, script, report and cloned profile under this directory.

Coverage decision plan.
Map new browser/oracle/main-driver success paths to exact report/trace/raw-state points. Failure-only diagnostics, optional development flags, declarative metadata and generated content hash changes may be waived with concrete reasoning; production branch needs the separate production run. No changed runtime hunk exists to re-prove. Do not introduce unrelated runtime, stress, cold-clone or sabotage gates for this medium integration task.

N2 — Independently reversed restore order (extension recorded before its run).
In a new disposable clone, rehydrate deleted original Alpha using its authenticated original raw frame and the shared original admitted Beta configuration through existing SessionCheckpoints.save. Before/after save machine SHA must equal `7b8d3d522a7041d796265d4793a23f73e3fa6edcbd21f678cee80eec4514aea1` and canonical disk root `79c6d4548f1ad7da1625e296081b86492c2346c72a66ff4bb46b0b1216e5213d`. Independently choose Alpha→Beta; each actual Open must restore its original paused tuple/queued input/held keys with zero slices. After Resume the real shell must return Alpha/Beta original same-path file bytes and RAM/consumed queued values. Continue N1 literal rename/reload/fresh-tab on Beta. Original worker profile/frames/report remain unmodified.
