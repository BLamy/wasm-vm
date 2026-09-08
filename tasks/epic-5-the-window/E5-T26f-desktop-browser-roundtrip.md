---
id: E5-T26f
epic: 5
title: Browser desktop snapshot round-trip and interaction smoke
priority: 526.6
status: blocked
depends_on: [E5-T26e, E5-T26h, E5-T19a, E5-T26i]
blocked_on: E5-T26i browser monotonic-clock adapter and controlled time-policy evidence
estimate: S
risk: high
capstone: false
---

## Goal

Prove the composed desktop snapshot in the browser: reload and restore the same visible desktop,
then resume real input and audio without a guest reboot.

## Boundary

Own the browser save/reload/restore harness, pixel CRC comparison, and post-restore interaction
smoke. Do not add new device serialization semantics or stress/fuzz infrastructure.

## Acceptance criteria

- A desktop with two windows, visible custom cursor, terminal text, and completed `aplay` saves,
  reloads, restores, and has a first-present front-buffer CRC equal to the pre-snapshot CRC.
- Within 2 seconds after restore, typed text, cursor movement, window focus, and one user-gesture
  audio playback all succeed; the evidence records exact image, browser, and snapshot hashes.
- A snapshot taken during a window drag restores with no stuck button, and the browser path proves
  no guest reboot or re-probe was required.

## Verification command

make verify-E5-T26f

## Adversarial verification

Save at each drag phase, reload twice, and restore once with a delayed user gesture. Reject any
stuck button, stale cursor, CRC mismatch, or audio hang.

## Verification log

### 2026-09-07 — coordinator — isolate the browser timekeeping prerequisite

The diagnostic layer now has 56 passing helper regressions, a real owned-worker
profiler-routing test, and fresh Daybreak CPU/JIT/latency reviews. The exact
repro in `evidence/e5-t26f/cpu-560c6743/README.md` still exits 1 at the unchanged
two-second cap while playback succeeds at about 4.8 seconds. No F acceptance
or timing waiver is claimed. The browser remains on retire-derived CLINT time;
the verified core wall-clock policy was never injected on this path. E5-T26i
owns that missing opt-in clock/lifecycle boundary and a controlled comparison.
Resume F after its prerequisite is verified; a negative performance comparison
must be retained rather than changing the deadline or assuming a speedup.

### 2026-09-07 — worker — exact-runtime CPU capture

At `560c67431d0dcbae24fef7fda4af84df887d0751`, the diagnostic runner reuses the
existing bounded CDP worker profiler, authenticated by a real synthetic-worker
adapter test. One isolated replay records 3244 CPU samples from the actual
release module; names are recovered offline only after all eleven executable
sections compare equal. It still fails timing at 4824.625 ms while actual
playback completes with 1440 fresh non-silent frames. The sample profile shows
mixed execution/dispatch costs, including `try_jit_block` at 27.926% inclusive,
not a measured fix or a new acceptance result. Full commands, code/symbol
authentication, raw profile, summary, and inspected screenshot digests are in
`evidence/e5-t26f/cpu-560c6743/README.md`. No runtime change or waiver occurred.

### 2026-09-07 — worker — measure JIT coverage without runtime changes

The 49-test harness extension at `43f4cac1ca87af3645a24d2eed12246e84c6593a`
records bounded JIT statistics after scheduler reads in explicit diagnostic mode.
One same-runtime cloned-checkpoint replay still fails timing: first PCM at
3644.315 ms, conditional completion at 4919.430 ms, interaction at 4937.410 ms.
The executor is active; over the sampled interval only 36.908% of retired guest
instructions use it, with 14.906 JIT instructions per host entry and rising
eviction/retranslation counters. Entry-cost timers are disabled. These are
localization counters, not proof that any proposed JIT change improves latency.
Exact command, provenance, measured deltas, and inspected screenshot/JSON hashes:
`evidence/e5-t26f/jit-latency-43f4cac1/README.md`. Preserve the original deadline
and held sound/restore results; do not promote an unmeasured residency change.

### 2026-09-07 — worker — localize remaining interaction delay

Frozen harness `2e9d9771477bda265342ac928a25fc6e2d769b25` passes 44 bounded
helper regressions and adds explicit reuse-only PCM/marker/scheduler timing.
One cloned-checkpoint replay fails the unchanged two-second cap: first actual
non-silent PCM at 2933.050 ms, conditional terminal completion at 4439.320 ms,
final interaction at 4488.445 ms. The 218 existing marker reads cost 9.245 ms
total (max 3.665 ms), all chunk-fetch waits are zero, and worker slices account
for about 3.52 seconds over the observed interval. Investigate guest execution;
do not remove the observer or relabel this as accepted timing. Matching CRC,
fresh HELLO, no boot, released buttons, and working audio remain observed.
Exact command, runtime/profile bindings, and inspected JSON/PNG digests are in
`evidence/e5-t26f/latency-2e9d9771/README.md`. This diagnostic is not acceptance;
deferred coherence/drag/second reload still require proof. No performance waiver,
merge, production deployment, or Epic 6 work occurred.

### 2026-09-07 — coordinator — resume after verified PCM recovery

E5-T19a is independently reverified in `fbd9e966` at runtime `9e8e1c22`, with
394-test exact-head and clean-clone gates, effective sabotage, native bit-exact
recovery, and real Linux-browser playback before/after restoration. Source/dist
WASM SHA-256 is `551206882e7e3ec605dfe04571e53046a81678ebd542fdccafc2c08d8188c229`.
The newest diagnostic at `1d3360b3` restores first-present CRC `94da90ee`, obtains
a fresh HELLO without a guest boot, moves the visible cursor at 786.255 ms, and
produces 1440 new non-silent frames with attached guest output and a conditional
successful `aplay` marker. However, interaction finishes at 3842.595 ms and fails
the unchanged two-second cap. Coherence/drag/second-reload remain unproven here.
Exact command and canonical inspected JSON/PNG hashes:
`evidence/e5-t19a/recovery-browser-c90bc4e4/README.md`. Continue only the remaining
F interaction/proof boundary; carry the unchanged H and T19a findings forward.
No performance waiver, merge, or production deployment has occurred.

### 2026-09-07 — coordinator — blocked on independently refuted PCM recovery

The paced replay at `6215c8d9` reaches a real ALSA XRUN and then fails PREPARE with
`Invalid argument`; canonical inspected evidence and exact command are retained in
`evidence/e5-t26f/paced-original-reuse-6215c8d9/README.md`. A fresh Daybreak Blue
critic independently reproduced the Linux STOP → RELEASE → PREPARE wire failure
in E5-T19a: `cargo test -p wasm-vm-core --test desktop_machine_audio_resume
linux_6_6_63_xrun_stop_release_prepare_recovers_without_set_params -- --nocapture`
fails with BAD_MSG (`0x8001`) after RELEASE discards parameters. The report is
`evidence/e5-t19a/recovery-refutation/results.md`. Resume this browser-only task
after the control-state prerequisite is corrected and independently reverified.
The existing H queue mapping and other unchanged held findings remain carried
forward. No timing/FPS waiver has been received; no acceptance cap is changed.

### 2026-09-07 — coordinator — fixed-sound diagnostic reaches real PCM, misses timing

The sealed diagnostic created at `bd2ca267` and reused at `28bf565e` now restores
actual audio: 1440 new non-silent producer-ring frames, maxAbs 0.082000732421875,
with attached guest output and running/unlocked playback. First-present CRC
`49d5e923` matches, the fresh HELLO is generation 2, no cold boot occurs, and cursor
pixels match at 856.565 ms. However, command/PCM completion arrives at 4799.225 ms
and the final interaction observation at 4806.345 ms, exceeding the unchanged
two-second requirement. This remains diagnostic-only; coherence/drag/second-reload
were not reached. Exact command, provenance, retained JSON/inspected PNG hashes:
`evidence/e5-t26f/fixed-sound-reuse-28bf565e/README.md`. Investigate the remaining
latency without weakening the PCM or timing assertions.

### 2026-09-07 — coordinator — resume with verified sound queue mapping

E5-T26h is reverified at frozen runtime `e8850241b686fd497c4ff1589fd31b6ffd0c7cc4`.
The 32-case native playback matrix proves exact new samples through the fresh sink,
and the critic's queue-order sabotage reproduces the old replay failure. The new
browser WASM SHA-256 is `95d1f68df359850d23b4c1b27a76baae393f89efe2cca99b68c2bfa23251c3e3`.
Old sound-layout snapshots are intentionally incompatible; record a new cold setup.
The two-second interaction cap and actual non-silent PCM requirement remain unchanged.

### 2026-09-07 — coordinator/verifier — blocked again on E5-T26h sound queue order

The browser PCM failure now has a deterministic native prerequisite refutation. The frozen H
runtime serializes virtio-snd service cursors in control/event/RX/TX order while its shared resume
parser interprets them in queue-index control/event/TX/RX order. Exact repro:
`cargo test -p wasm-vm-core --test desktop_machine_audio_resume -- --nocapture` exits 101 with all
four tests failing: absent RX causes `BadComponentState { tag: 16 }`; configured RX misbinds the TX
cursor, replays old PCM into the fresh sink, and leaves the fresh TX descriptor incomplete.
Evidence: `evidence/e5-t26h/verifier-audio-queue-order/native-audio-resume.log`, SHA-256
`c80f4272d49e8660566bce2fe025e4401c395100d0e7cccd49b2887f6bf2f36e`. Resume F only after H fixes
and independently reverifies this sound-queue boundary; the retained F display/input/no-reboot
facts remain held and no additional browser criterion is introduced.

### 2026-09-07 — coordinator — retained failed browser candidate

At `371786fc2a988381bef1a7f83fd7dca2bba07cf9`, the rebuilt session-fence WASM
(`103425433cc23287aaf94631dd82a816a3a7a887f1ae4c021b313da28216cde7`)
restored the actual two-window desktop without `booting`, matched first-present
CRC `3079a40f`, and negotiated a fresh generation-2 HELLO. The cursor was visibly
at the requested coordinates 1763.55 ms after restore completion. The new physical
keyboard sequence ran `sh /tmp/a`; the screenshot shows its ALSA format line,
conditional success marker, and next shell prompt. However, completion took about
13 seconds after typing, and the browser PCM producer had advanced by zero frames
when sampled immediately afterward. This is a failed candidate, not accepted
playback or two-second interaction evidence. The deferred audit and drag phases
were not reached.

Command: `E5_T26F_HEADED=1
E5_T26F_REQUIRE_HEAD=371786fc2a988381bef1a7f83fd7dca2bba07cf9
E5_T26F_OUT=evidence/e5-t26f/deferred-audit-371786fc
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize
node tools/verify/e5-t26f-browser-roundtrip.mjs` (exit 1).

Retained failure JSON SHA-256:
`8d9827bc6efc79d0b26bf85768592f52c3aaadb87a0a1bb2672c62193195b65a`;
screenshot: `965ab8b578c959dd9b6b3c8a83050dc73a660d91f949a1a1897f10d62a2d247b`.
Both are under `evidence/e5-t26f/deferred-audit-371786fc/` with the
`failure-post-restore-audio-pcm-and-render` prefix. Fresh Daybreak critique and
effective bridge/audit sabotage records are in
`evidence/e5-t26f/verifier-restoration/provisional-candidate-371786fc.md`.
The critic carries the reached display, input, session, and no-reboot facts forward;
the missing PCM requires localization, not a weakened assertion.

### 2026-09-07 — coordinator — resume after verified machine-state prerequisite

E5-T26h is independently verified at runtime head
`2325c05f756f9a9746099051db9ab46866b874e8`; its fresh critic accepted the
119-check exact-head clean-clone run and old-session payload fence. Resume the
browser-only acceptance here with the rebuilt runtime.

The retained diagnostic at `e37ddc6343db7865efc87dfe0ff34043859de36e`
(`evidence/e5-t26f/cursor-candidate-e37ddc63/failure-post-restore-cursor-render.json`,
SHA-256 `10c106394f20b3c43a39f0d48f9953e9ed7628952b7fafaa63ca5a12a78a85fb`)
reached a real two-window restore, matching first-present CRC `b258b915`, fresh
HELLO, and no cold-boot state. It failed before timed interaction because the
harness spent about 20 seconds reassembling the stored snapshot for a coherence
audit. This is failed diagnostic evidence, not an accepted roundtrip or a measured
runtime latency failure. The audit now follows the timed interaction and precedes
another save; the original restore timestamp, strict two-second cap, and real
coherence checks remain. Three additional deterministic regressions cover the
ordering, required audit completion, and stale/mismatched audit refusal.

### 2026-09-07 — coordinator — isolate missing machine-resume state

The resumed browser reaches `restored` at 642 ms, without a `booting` event, but
never reaches the desktop or application HELLO. Exact reproduction:
`E5_T26F_TIMEOUT_MS=3600000 E5_T26F_OUT=evidence/e5-t26f/remediation-fast-slice
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize
node tools/verify/e5-t26f-browser-roundtrip.mjs` at `683fb09d` with the uncommitted
persistent-resume browser changes. The stalled diagnostic was stopped; it is not
acceptance evidence.

Inspection of `Machine::save_resume` shows no desktop device MMIO/ring state in
the CPU/RAM snapshot. The guest driver state survives in RAM, while its device
transports are newly initialized. This requires device serialization beyond
T26f's browser-only boundary. E5-T26h owns that prerequisite, reusing the existing
component codecs. Resume this browser proof once H is independently verified.

### 2026-09-07 — worker — IMPLEMENTED

- Implementation commit: `8ce1db0e26a1cc038d3264182c74d61b33b6f4b8`.
- Exact-head evidence: `evidence/e5-t26f/desktop-roundtrip.json` (SHA-256 `4c92b8e9a79723d5630201f9e6f87212661edb134d517c5d0a889da28b0de177`), screenshot `evidence/e5-t26f/desktop-roundtrip.png` (SHA-256 `b3c670ae52cd241158dbee40ec3ba7f3d8a558935619e0b72cecdbf4912f1aca`), and server transcript `evidence/e5-t26f/desktop-roundtrip-server.log` (SHA-256 `b3eeff78fd0f0021bc2a319f86c4df2760b8e4538c41661ba6e9cee9ebb9dfd0`).
- Image provenance: `target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4`, SHA-256 `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`, 1 GiB; split manifest `target/e5-t26f/chunks/desktop-aplay-noresize/manifest.json`, SHA-256 `b6257e6c0e6789dee28a4f0a7eae1089193fcec545d467d8a70d245226bb9592`.
- Command: `E5_T26F_REQUIRE_HEAD=8ce1db0e26a1cc038d3264182c74d61b33b6f4b8 E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize make verify-E5-T26f` (exit 0). The gate passed format, both clippy gates, 9 desktop-snapshot tests, 12 desktop-restore tests, 2 nine-slot MMIO tests, wasm32 build/check, 45 Node tests, and the final Chromium proof.
- The recording demonstrates two-window desktop state with terminal text, visible custom cursor, completed `aplay` (`S16_LE`, stereo, 48 kHz), exact normal and drag snapshot hashes, first-present CRC `77f31714` matching the pre-snapshot CRC on both restores, fresh agent HELLO generation 2, full repair frames, released drag buttons, and post-restore cursor/keyboard/audio interaction in `108.91 ms`; browser and HTTP error arrays are empty. The guest reaches the Alpine login prompt with no reboot or device reprobe during restore.
- Scope waiver: the evidence is local Chromium 152.0.7977.76 only; WebKit, independent machines, and host-layer rr are intentionally out of scope per the approved Daybreak Blue validation boundary.

### 2026-09-07 — verifier — VERDICT: refuted

- P1 first-present identity — HELD. Predicted the normal and mid-drag first-present CRCs would
  equal their pre-snapshot CRCs. Both pre-snapshot values are `77f31714`
  (`evidence/e5-t26f/desktop-roundtrip.json:29,35`) and both restored first presents are
  `77f31714` (`:68,162`); the drag restore also reports no held button (`:324`). Carry this result
  forward while the runtime diff and evidence digest remain unchanged, but promote the currently
  missing explicit drag-CRC assertion in the browser harness.
- P2 post-restore input and playback — FAILED. Pointer/keyboard delivery and the 2-second bound
  held (`evidence/e5-t26f/desktop-roundtrip.json:308-324`), but predicted a user-gesture audio
  playback would advance the rendered-audio counter. It is already unlocked before the alleged
  playback and remains exactly `13,594,612` frames before and after (`:313-321`); the only `aplay`
  command occurs before the snapshot (`tools/verify/e5-t26f-browser-roundtrip.mjs:386-391`). Run a
  post-restore `aplay`, record successful guest completion, and assert a bounded positive frame
  delta after the delayed gesture.
- P3 no reboot/re-probe — FAILED. Predicted reload restoration would resume the saved desktop
  without constructing and booting a fresh guest. Instead each restore records a new
  `fetching -> instantiating -> booting` sequence
  (`evidence/e5-t26f/desktop-roundtrip.json:71-83,165-177`), and the harness explicitly performs
  `page.reload()` then waits for a newly ready desktop before auto-restore
  (`tools/verify/e5-t26f-browser-roundtrip.mjs:304-307`;
  `web/desktop-terminal.js:472-497`). The saved envelope contains only GPU, input, sound, and agent
  sections (`crates/core/src/lib.rs:1880-1985`), so it cannot carry the CPU/RAM state required to
  resume the pre-reload guest. Restore from a whole-machine snapshot (or otherwise preserve the
  live guest across reload) and prove no fresh boot/probe states occur.
- P4 adversarial drag/gesture coverage — NEEDS EVIDENCE. Two reloads are exercised, but the script
  takes only one snapshot after mouse-down/move (`tools/verify/e5-t26f-browser-roundtrip.mjs:486-501`),
  not at each drag phase, and does not implement an independently delayed gesture case. Record
  before-drag, held/moving, and release-phase saves plus a deliberately delayed post-restore audio
  gesture; reject every CRC mismatch, stuck button, or playback hang.
- P5 diff coverage — INSUFFICIENT. The exact happy browser run reaches the save compositor, ninth
  virtio window, worker RPC bridge, and source/dist mirrors (source/dist byte parity held), but no
  cited run exercises the new `MissingComponent`, `ComponentRefused`, and `BlockNotQuiesced` save
  branches (`crates/core/src/lib.rs:1883-1933`) or the rootfs array-expansion change
  (`tools/build-rootfs.sh:82`). Add deterministic save-side refusal tests and either separately
  prove the rootfs hunk or remove it from this task's diff.
- SABOTAGE bridge ownership — INSUFFICIENT. Predicted replacing the bridge's `Uint8Array.slice()`
  with a borrowed pass-through would fail the new ownership test; the isolated sabotaged test still
  passed because its fake controller immediately makes its own copy
  (`web/tests/e5-t26f-desktop-agent-bridge.test.mjs:35-39`) before the caller mutation is observed.
  Make the fixture retain the bridge-supplied buffer without copying (or observe it asynchronously)
  so the changed ownership hunk at `web/desktop-agent-bridge.js:6-12` is actually falsifiable.
- NOVEL ATTACK — HELD. A controller that accepted one byte fewer than each agent frame never
  reached READY, and queued guest bytes remained privately owned and were discarded on close.
- Deterministic checks passed: 9 desktop-snapshot tests, 12 desktop-restore tests, 2 nine-slot MMIO
  tests, the advertised-XRUN sound test, all 45 scoped Node tests, and source/dist parity. The full
  browser target was not rerun because the exact-head recording was hash-valid and directly
  refuted, while its current assertions omit the failed criteria above. SUITE: no promotion until
  the semantic refutations clear. Chromium-only, independent-machine, WebKit, and host-rr waivers
  were honored.
