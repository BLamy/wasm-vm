---
id: E5-T16e
epic: 5
title: Publish measured display-server decision and T17 handoff
priority: 516.5
status: verified
depends_on: [E5-T16d]
estimate: S
risk: medium
capstone: false
---

## Goal

Turn the two inside-emulator finalist captures and package audit into a re-litigable display-server
decision, with winner variance, damage recomputation, revisit triggers, and an unambiguous T17 handoff.

## Boundary

This slice owns final evidence synthesis and `docs/decisions/display-server.md`. It does not build
the T17 desktop image or add a third candidate after the two finalists have been measured.

## Deliverables

- `docs/decisions/display-server.md` with a comparison table for labwc/pixman and weston/pixman,
  actual numbers for every required metric, the chosen server/WM/terminal/clipboard stack, package
  versions, config sketch, and concrete revisit triggers.
- Two fresh winner reruns and an independent recomputation of the 100-character damage bytes from
  the T09 counters, with evidence links and exact image/commit identities.
- A final package/config manifest explicitly handed to E5-T17 and a machine-readable summary for
  later performance and desktop tasks.

## Acceptance criteria

- The table contains at least two end-to-end inside-emulator finalist rows with no extrapolation;
  cold start, idle instructions, damage bytes, RSS, idle wakeups, cursorq use, and workload outcome
  are all visible for both.
- Winner run-to-run variance is measured twice and compared with the winning margin; if variance
  exceeds that margin, the command fails and the decision remains unpublished.
- Idle cost above 2% disqualifies a candidate or is explicitly justified, and the document cites
  the independently recomputed typing damage bytes.
- The selected server, WM, terminal, and clipboard tool are all backed by E5-T16d riscv64
  `apk search`/`apk add` evidence, with no ambiguous dependency left for T17.
- If labwc wins, cursorq traffic is present in the evidence; if another candidate wins, the reason
  for not relying on the cursor plane is recorded. Revisit triggers include a concrete rendering
  or package change such as virgl/WebGPU support.

## Verification command

`make verify-E5-T16e`

## Adversarial verification

Re-run the winner twice from cold state, compare variance to the runner-up margin, and recompute
typing upload bytes from raw T09 counters rather than the summary JSON. Inspect weston's pixman
proof, labwc's cursorq proof if applicable, and every selected package install on a clean E3-derived
riscv64 image. Any undocumented GL/fbdev substitution, stale evidence head, or ambiguous T17
manifest refutes the decision.

## Verification log

### 2026-09-05 — worker — IMPLEMENTED

- Commit: `64abae1b813ea9eda66a3dee5887d5e93ec33d1e`.
- Command: `make verify-E5-T16e` (passed). This ran the CLI fmt/clippy/test/build gates, built a
  fresh signed Alpine v3.20 riscv64 Weston/Pixman image, replayed the frozen six-phase T16a
  workload twice from clean copies, synthesized the decision, and passed the variance/damage
  mutation self-test.
- Decision: Weston DRM/Pixman with foot and wl-clipboard. The prior end-to-end captures measure
  labwc idle ratio `0.4568175750%`, Weston idle ratio `0.3637762568%`, and a winning margin of
  `0.0009304131819650491` ratio (`0.0930` percentage points); both candidates are below the 2%
  idle budget. Labwc reports `cursorqEvents: 0` with a capability-gap status, so the selected
  stack does not rely on an unproven cursor plane.
- Independent T09 damage recomputation from raw `type-100` counters: labwc `0` bytes and Weston
  `36,864,000` bytes for 100 characters. Fresh Weston idle ratios were `0.0036462359033466426`
  and `0.0036463767176481247`; maximum deviation from their mean was
  `0.00000007040715074109125`, below the winning margin.
- Fresh source identity: image `27bbdc06f63fd611fbb2c071d56b5ec1bbfd696a8d9180c81c33a45e5ed5ed95`,
  package manifest `225b8d35f7375c084075ca60edac5ea8fbf7ef46f1fd09a7e3a5d40bb074aae1`, and file
  manifest `b2b4964035b5a348be808afddc83b91d007c5cb3e5fbfcf1854b6f85d5d51552`. Both reruns used
  that exact source image; their post-run image digests were distinct (`d1b726d49225b28511f378e1f581c27213c48c4481f9436bbdd3db53b8688e4a` and
  `7291ff674d6db690ff5eb7606dc2e5515065331865a44c65bb2e9849708230ee`).
- Evidence: `evidence/e5-t16e/winner-reruns.json` (SHA-256
  `5f7ad616a147eec62bbd0a609ad6fcdb3bbd7fd6a498851137299e5b20eab1d5`),
  `evidence/e5-t16e/display-server-decision.json` (SHA-256
  `d7e7c3b4a18f09af7d9132f7b75f1dfe0a6b3d191eed6e9db52182ca24029b18`), and
  `docs/decisions/display-server.md` (SHA-256
  `9e5ab89e22a8ff6f045919a4681d888388a2caff0cc6f4a5fdf8016f62ba3540`). The per-run console,
  guest-evidence, GPU-trace, stderr, and normalized run JSON files are listed and hashed in the
  rerun artifact. Independent-machine, WebKit, and host-rr legs are intentionally out of scope.

### 2026-09-05 — verifier — VERDICT: verified

- P1 exact head and stale bindings — HELD. Predicted the evidence would either bind to the exact
  acceptance-bearing implementation or fail as stale. `evidence/e5-t16e/winner-reruns.json:6-20`
  binds the reruns to implementation head `64abae1b813ea9eda66a3dee5887d5e93ec33d1e` and the
  clean source image, package-manifest, and file-manifest digests. `HEAD` is publication commit
  `c34dfaca4b1159d15c9d77799b9ca51e3051ccf5`, whose direct parent is that implementation head;
  the parent-to-HEAD diff contains only docs, evidence, task log, queue, and generated task
  metadata, with no acceptance-bearing source or harness hunk. Recomputed artifact hashes match
  `winner-reruns.json:31-55,81-105`, so the implementation-head binding is not stale.
- P2 decision table and no extrapolation — HELD. Predicted both measured finalists would have all
  required fields and raw-capture provenance. `docs/decisions/display-server.md:11-26` contains
  labwc/Pixman and Weston/Pixman rows for cold start, guest instructions, idle instructions/ratio,
  type-100 damage, RSS, idle wakeups/rate, cursorq, and workload outcome, with links to the raw
  captures; the same measured values are present in
  `evidence/e5-t16e/display-server-decision.json:21-55`.
- P3 raw T09 damage — HELD. Predicted independent `uploadedBytes` deltas would match each summary.
  Labwc raw type-100 counters at `evidence/e5-t16b/labwc-capture.json:145-160` recompute to `0`
  bytes and Weston counters at `evidence/e5-t16c/weston-capture.json:145-160` recompute to
  `57,344,064 - 20,480,064 = 36,864,000` bytes; both summaries record those results at each
  file's `:229-243`. The two fresh Weston reruns repeat the same raw calculation at
  `evidence/e5-t16e/weston-rerun-1-capture.json:145-160` and
  `evidence/e5-t16e/weston-rerun-2-capture.json:145-160`. The validator independently enforces
  this recomputation at `tools/verify/e5-t16e-display-server-decision.mjs:128-135`.
- P4 fresh winner reruns — HELD. Predicted two cold reruns would use byte-identical source images
  and produce distinct post-run images. `winner-reruns.json:25-29` and `:75-79` show identical
  preimage digests equal to the source, while the two post-run digests are distinct from the source
  and from each other. The six-phase captures have no recorded errors; the source, preimage,
  postimage, and artifact-digest checks are fail-closed in
  `tools/verify/e5-t16e-display-server-decision.mjs:187-217`.
- P5 Weston DRM/Pixman/no-GL and trace cleanliness — HELD. Predicted both winner reruns would use
  the exact DRM/Pixman path and finish with clean guest/GPU evidence. The exact launch, `riscv64`
  guest, and `Using Pixman renderer` proof appear at
  `evidence/e5-t16e/weston-rerun-1-console.log:309-331` and
  `evidence/e5-t16e/weston-rerun-2-console.log:309-331`, with no GL renderer/flag match. Guest
  evidence ends `outcome=Exited(0)` at each `weston-guest-evidence.txt:1-6`; GPU traces report
  `records=121 dropped=0` and `records=116 dropped=0` at each `weston-gpu-trace.log:1-2`. The
  capture error and exact launch assertions are enforced at
  `tools/verify/e5-t16e-display-server-decision.mjs:197-217`.
- P6 idle, winner margin, and variance — HELD. Predicted all candidates and reruns would stay at
  or below the 2% idle budget and that winner variance would be strictly below the runner-up
  margin. `evidence/e5-t16e/display-server-decision.json:5-18` records margin
  `0.0009304131819650491`, rerun spread `1.408143014821825e-7`, and maximum absolute deviation
  `7.040715074109125e-8`; the candidate and rerun ratios at `:21-55` are below 2%. The documented
  comparison and variance method agree at `docs/decisions/display-server.md:39-46`.
- P7 T16d signed riscv64 package closure — HELD. Predicted every selected Weston/foot/clipboard/
  seat/udev/font/Pixman/XKB package would have successful riscv64 search, signed native install,
  and exact installed version. The verified T16d handoff lists all 11 Weston packages and versions
  at `evidence/e5-t16d/package-audit-verification.json:42-63`; the audit policy requires default
  signature verification and forbids `--allow-untrusted` at
  `evidence/e5-t16d/package-audit.json:19-23`. The raw Weston audit shows riscv64 repository and
  search setup at `weston-pixman-console.log:303-315,375-377`, clean `apk add --no-scripts
  --no-progress` installation and `OK` at `:500-613`, and package info, complete manifest, and pass
  marker at `:618-620,1460-1662`. The independent T16d validator and all of its negative
  self-tests passed.
- P8 bounded attack, self-test, and changed-hunk coverage — HELD. Predicted a rerun capture
  mutation with its claimed SHA-256 left unchanged would be rejected before semantic acceptance.
  In a temporary copy, changing only rerun-1 `peakRssBytes` caused verifier exit `1` with
  `capture digest drifted`, exercising `tools/verify/e5-t16e-display-server-decision.mjs:200-203`.
  The committed variance/damage mutant self-test passed with
  `E5T16E_SELF_TEST=variance-and-damage-rejected`. The rerun harness is covered by
  `winner-reruns.json:31-128`, the per-run evidence-directory change is covered by the two run
  artifacts from `tools/run-weston-pixman.mjs:27`, and the validator/Make wiring is covered by
  `tools/verify/e5-t16e-display-server-decision.mjs:176-239` and `Makefile:768-784`. Defensive
  rejection branches are fail-closed guards, not unproven acceptance behavior.
- Deterministic gates and scope — HELD. All three task scripts passed `node --check`; T16e normal
  verification and self-test passed; T16d normal verification and self-test passed; fmt, clippy
  with `-D warnings`, and the release build passed. The full guest replay was not repeated because
  the exact implementation-head evidence is neither stale nor contradicted. The native CLI test
  command was attempted and hit the pre-existing OCI failure at
  `crates/cli/src/oci/pull/tests.rs:286` (53 passed, 1 failed), already recorded by the prior T16d
  verifier at `tasks/epic-5-the-window/E5-T16d-alpine-display-package-audit.md:64-70`; that code is
  outside this task's implementation diff and does not refute E5-T16e. Independent-machine,
  WebKit, and host-rr legs were omitted per the explicit scope and repository policy.

Commands: `git rev-parse HEAD`; `git diff --name-only dffb17336fa53277419dd0634e734bb5f79b9897 HEAD`;
`node --check tools/run-weston-pixman.mjs tools/run-e5-t16e-weston-reruns.mjs tools/verify/e5-t16e-display-server-decision.mjs`;
`node tools/verify/e5-t16e-display-server-decision.mjs`; `node tools/verify/e5-t16e-display-server-decision.mjs --self-test`;
`node tools/verify/e5-t16d-package-audit.mjs`; `node tools/verify/e5-t16d-package-audit.mjs --self-test`;
`cargo fmt --check -p wasm-vm-cli`; `cargo clippy -p wasm-vm-cli --features gpu-trace -- -D warnings`;
`cargo test -p wasm-vm-cli --bin wasm-vm --features gpu-trace` (unrelated pre-existing OCI failure
noted above); `cargo build --release -p wasm-vm-cli --features gpu-trace`.
