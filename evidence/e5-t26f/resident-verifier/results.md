# Resident fixture — incremental critic, frozen 7da05062

Interim result: **no new refutation in the reviewed fixture/build/harness boundary**.
This is not an F acceptance verdict. Browser evidence is pending and has not been
opened, including the live cold transcript. No status change, commit, runtime edit,
browser run, build, J resampling or broad gate was performed.

Reviewed `00cad42c..7da050620031145b6e76cf150a894ed2710bd5b2`, the full F task and
AGENTS charter. Predictions were recorded in `predictions.md` before inspecting
the new build/gate records. The earlier queued playback-XRUN finding is closed;
the frozen parser additionally validates capture enablement for capture events.
There are no changed `crates/` or `web/` files in this commit range.

## Results and evidence

- **P1 — HELD (construction, not playback).** Independently streamed both 1-GiB
  images, authenticated all 28 retained successful-build artifacts, checked
  actual helper readbacks, root:root/0444/one-link/fixed-time inode records, all
  five fsck passes, exact preserved package lock and one appended file entry.
  Both builders exited zero using the same final builder/helper bytes; their
  earlier checkout name does not misbind those bytes. The initial package-query
  failure remains separately authenticated as exit 1. All 8,192 chunks were
  individually hashed and reassembled in memory-order into the same image hash.
- **P2 — HELD for deterministic guards; NEEDS EVIDENCE for actual guest.**
  Thirty-five tests execute the helper's real observer/play logic with proc and
  device paths substituted only in test copies. Exact 3840-byte output is checked
  against independent literal samples with no executable in PATH during `play`.
  Wrong identity/descriptors, queued pointers, accounting changes, failed feed
  and child exit 23 refuse green success. Preparation scheduling uses explicitly
  mocked observations: it is not hardware PREPARED evidence. The earlier native
  file-over-null precheck remains mechanics-only. Actual guest pre/post values
  and same-child successful completion are still required from the browser.
- **P3 — HELD for reader/host guards; NEEDS EVIDENCE for actual saved state.**
  Thirteen proof-module tests authenticate envelope/section/trailer hashes,
  parameters, TX index 2, event payloads and two zero-ring pregesture samples.
  The novel rehashed attack accepts 256 enabled-capture events, rejects 257, and
  rejects a playback XRUN in slot 255 despite all preceding events being valid
  capture events and the outer sections being reordered. Opaque non-sound test
  payloads test reader selection only, not core restoration. No all-queues-empty
  claim is made for permitted control/event/capture notifications.
- **P4 — NEEDS EVIDENCE.** Source retains restore `completedAt` as T0 and the
  original all-success end/cap. The extra pregesture reads, 350-ms delay, physical
  `play` at 5-ms edges, guest conditional completion, immediate positive fresh
  PCM, attached/running output and visible interaction all remain inside that
  interval. No first-PCM-only or preexisting green-marker substitute is accepted
  as final proof. A <=2000-ms actual record is still necessary.
- **P5 — prior functionality HELD, new composed run pending.** Carry unchanged
  CRC/receipt/fresh HELLO/no-boot, real drag-phase saves, delayed gesture and
  guest-acknowledged stationary hover from the prior critic. That canonical
  diagnostic remains hash-identical and still failed at 5050.230 ms. The resident
  image's new full sequence must independently reach those endpoints; earlier
  images are not relabeled as resident acceptance.
- **P6 — HELD at scoped test/source boundary.** Opt-in exact-string selection,
  rejection of all diagnostic tuning/profiling/pacing/command overrides, fixed
  physical command, output protection, helper/image binding, and reuse checking
  of actual snapshot and retained screenshot are exercised by the new modules.
  Legacy source-extracted tests only gain omitted fixture/clock dependencies;
  their assertions are retained. Make adds the three modules; its existing
  diagnostic rejection remains before acceptance execution.

The worker's committed log contains **233 pass / 0 fail / 0 skipped**, including
the recorded real Chromium helper regression. Independently reran only the
three new resident modules: **60 pass / 0 fail / 0 skipped**. No concurrent
Chromium was launched. Scoped diff whitespace check passed.

## Sabotage and coverage disposition

`node evidence/e5-t26f/resident-verifier/attacks.mjs` copies exact sources into
one owned temporary directory and scrubs RUSTFLAGS, RUST_LOG, CARGO_* and
NODE_OPTIONS for the focused tests. Three single-guard mutants are killed:

| Frozen boundary | Independent mutation and concrete result |
| --- | --- |
| `resident-proof.mjs:67` | Remove playback-event refusal: selected regression exits 1; an enabled-capture envelope with a final playback event is actually accepted by the mutant, proving the guard matters semantically. |
| `e5-t26f-resident-aplay.sh:164` | Replace `wait "$e5_pid"` with success: child-exit-23 test observes erroneous status 0 and fails at test line 159. |
| `resident-image.mjs:183` | Omit installed-helper byte comparison: corrupt-readback scenario is wrongly published and the test fails with missing rejection at test line 208. |

Original sources are restored in the isolated copy after each mutation and the
shared source hashes remain identical before/after. Mutation targets, exact
replacement strings, source hashes, commands, exit codes and logs are retained
in `attacks.json`. No permanent implementation or test-source change was made.

Changed helper observation/feed/completion guards are covered by real shell
execution over deterministic fake proc files; actual hardware launch/preparation
and restored process continuity remain **needs-evidence**, not waived. Routine
preparation resource-error plumbing is source-reviewed fail-closed and not a
claim of exhaustive fault injection. Builder guards/refusals are exercised by
12 orchestration tests; positive Docker/debugfs/fsck behavior is separately
covered by the authenticated actual A/B records. Runner selection/binding,
preparation refusal, pregesture ordering and reuse tamper paths execute extracted
real blocks with fake page/filesystem APIs: their actual browser positive paths
remain **needs-evidence**. Imports, metadata plumbing, comments, record-format
formatting and test-context additions are **waived as nonsemantic scaffolding**.
No changed runtime hunk or dead implementation is hidden behind a mock.

The existing deterministic tests are useful permanent regression artifacts;
the novel boundary attack stays as a critic script. No further suite promotion
is needed before the missing real browser proof. Defer the one pristine local
affected-harness clone until final acceptance head is established; do not clone
or cold-boot this still-pending iteration again.

## Digest ledger and scope

Mechanically checked file digests (all SHA-256):

| File | Digest |
| --- | --- |
| `tools/guest/e5-t26f-resident-aplay.sh` | `2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c` |
| `target/e5-t26f/resident-image-2ae65408-a/alpine-rootfs.ext4` (B and reassembled chunks identical) | `27c2e8f2789b18efac214837c295dbfb22559beea350fb5788f71edfdc0f0a8e` |
| `target/e5-t26f/chunks/resident-2ae65408/manifest.json` | `2245a4d8b8b804bb200079c1ce00dee868762324f18627fa5d2b11fe032639ef` |
| `evidence/e5-t26f/resident-gates/focused-tests.log` | `3df786fe87433e1aa7085cc4fe7b99f4ce62bb6eb7092445b2d41ee90fff2278` |
| `evidence/e5-t26f/resident-verifier/focused.log` | `c28f50a8ff288ccdefeb6a2f872c38b8d973d96416f316c8b5497497c5bb2728` |
| `evidence/e5-t26f/resident-verifier/attacks.json` | `6e545d09efb579f26be1d29c5af7bacab6dd0a783541db69b203c8b7c65561d9` |
| `evidence/e5-t26f/resident-verifier/build-audit.json` | `b8719ca9c5677d31f744c91de166bbd1618817edbea10905fbce628bf07c71fe` |
| `evidence/e5-t26f/completion/critic.md` | `a811d6cf8cb637a1af74194c5a356c81c08bf023be41ba50627455fc9a069bcb` |
| `evidence/e5-t26f/completion/guest-release-8c892667/diagnostic-completion.json` | `28046f748fc855531d5bc77874cfff7c57ce85992e231eb68d369d85bdbf2e8a` |

`build-audit.json` retains the 66-file digest ledger and explicit known unrelated
dirty dist-manifest exceptions. Those two user-owned files and all unrelated
dirty E6/rootfs work were not staged, edited or included in a clean-generated-web
claim. Existing H/T19a/I/J boundaries remain HELD; no timing/FPS waiver, default
promotion, deployment or F verification is inferred.
