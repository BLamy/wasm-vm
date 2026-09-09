---
id: E5-T24b
epic: 5
title: Add the bounded guest clipboard bridge
priority: 524.2
status: verified
depends_on: [E5-T24a]
estimate: S
risk: high
capstone: false
---

## Goal

Connect the static guest agent to the guest desktop clipboard with a bounded, restartable bridge
that emits guest copies and applies host copies without touching the serial console.

## Boundary

This slice owns only guest-side clipboard integration, child-process/watch recovery, bounded
clipboard-to-agent queueing, and guest unit/fixture coverage. Host browser permissions, gesture
staging, echo suppression policy, and cross-browser proof belong to E5-T24c–d.

## Deliverables

- A fixed-path guest clipboard adapter using the selected Wayland tool with an explicit fallback
  contract when the desktop helper is unavailable.
- CLIP_SET emission and CLIP_GET application through the verified agent session, with 256 KiB
  bounds, strict UTF-8 handling, and no key/UART queue aliasing.
- Child-process death, missing-display, malformed-input, and restart recovery tests with bounded
  polling/backoff.

## Acceptance criteria

- [x] A guest clipboard change reaches the agent as one bounded CLIP_SET event and a host CLIP_SET
      is applied to the guest clipboard without using the serial console.
- [x] 3-byte, emoji/CRLF, and exactly-256 KiB text survive the guest adapter byte-exactly; 257 KiB
      and invalid UTF-8 follow the explicit rejection policy.
- [x] Killing or removing the clipboard helper causes bounded retry and recovery within 5 seconds;
      no child pile-up, busy loop, or unbounded queue is possible.

## Verification command

`cargo test -p wasm-vm-guest-agent -- --nocapture`

## Adversarial verification

Kill the watcher mid-copy, remove/recreate the display socket, flood 256 KiB through the guest
terminal, inject invalid UTF-8, and restart the agent during an in-flight CLIP_SET. Assert recovery
and explicit discard without dropping key frames or writing the UART.

## Verification log

### 2026-09-04 — worker — implementation submitted

- Commit: `ddfbf11` (`feat(e5-t24b): bridge guest clipboard to Wayland helpers`).
- Exact evidence: [`evidence/e5-t24b/guest-clipboard-bridge-2026-09-04.txt`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24b/guest-clipboard-bridge-2026-09-04.txt), SHA-256 `6099e78590aa327a3768e9d634f61ff5f1c297c1087eb3115aaafab43ba1d0ba`.
- Commands: `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_BUILD_RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS make verify-E5-T24b`; `node --check web/agent-channel.js`; `node --test web/tests/agent-channel.test.mjs`; fixed-path/static boundary checks; `make web-dist`; two `bash tools/build-agent.sh` runs in independent target directories followed by `cmp`.
- Claim: the static guest agent now exposes a fixed-path, bounded Wayland clipboard bridge with strict UTF-8 and 256 KiB validation, coalesced guest/host state, explicit capability/unavailable NAKs, direct child I/O without a shell, one-owner helper lifecycle, and bounded retry after child/display failures. The recorded fixtures exercise guest changes, host application, CLIP_GET, exact-size and invalid payloads, output pressure, child death, missing display, recovery, reset/discard, and the unchanged serial session path. Host rr/independent-machine and WebKit checks are waived per the user instruction.

### 2026-09-04 — verifier — VERDICT: verified

- P1 guest/host clipboard path — HELD. Predicted one bounded guest `CLIP_SET`, one host value applied through the clipboard backend, and a `CLIP_GET` response without serial-path mutation; observed by `clipboard_bridge_emits_changes_applies_host_values_and_answers_get` in the exact-head 14-test guest run and evidence digest `6099e78590aa327a3768e9d634f61ff5f1c297c1087eb3115aaafab43ba1d0ba`.
- P2 byte and payload bounds — HELD. Predicted byte-exact 3-byte/emoji-CRLF/exact-256 KiB handling plus explicit rejection of 257 KiB and invalid UTF-8; observed by the protocol and guest payload/backend tests, with no malformed payload reaching a clipboard slot or connection reset.
- P3 helper failure recovery — HELD. Predicted child death/missing display would produce bounded 100/200/400 ms retry timing, preserve at most one pending value, and recover by 700 ms; observed by `clipboard_bridge_retries_missing_display_and_child_death_with_bounded_state` and `clipboard_bridge_retains_host_set_across_helper_failures_and_reports_fallback`. The bounded novel child attack (`/usr/bin/yes`) was terminated at the 256 KiB output ceiling, while exact-256 KiB `/bin/cat` input completed.
- P4 diff coverage and boundary — HELD. The changed runtime hunks are exercised by the guest bridge, helper-I/O, malformed-input, reset, and output-bound tests; fixed constants/docs/generated browser parity are declarative or covered by static/source-dist checks. No networking, shell, URL, caller-supplied path, or UART alias was introduced. The user-waived independent-machine and WebKit checks were not required for this verdict.
