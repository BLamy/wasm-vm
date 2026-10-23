---
id: E9-T22e
epic: 9
title: Publish long GPU histories through bounded resident windows
priority: 524.922021
status: implemented
depends_on: [E9-T22b]
estimate: S
risk: high
capstone: false
---

## Goal

Publish long GPU histories through bounded resident windows without weakening the original exact-history contract.

## Boundary

One durable GPU recording publication boundary. Separate lifetime durable event count/bytes from fixed resident pending/interval limits. Do not alter guest semantics, native replay admission, full-history qualification or numerical budgets.

## Acceptance criteria

- [ ] Persist a production GPU journal with more than 4096 receipts and at least 67125760 block-envelope bytes, then reopen and independently authenticate every byte, sequence, manifest range and content reference without truncation.
- [ ] Keep pending batches at 256 receipts/4 MiB and GPU bodies/intervals at their existing 256-object/64 MiB bounds. Separate durable-history accounting from resident windows; no constants-only increase, dropped receipt or record-after-boot shortcut.
- [ ] Preserve immutable initial/provider/renderer/profile identity, append/CAS ownership, failure atomicity and retained older roots. Refuse an overfull resident batch and corrupt/missing content with precise evidence.
- [ ] Record the scoped high-risk local browser/store gates, actual demo proof, production release and final pristine proof. A fresh actual Daybreak critic must cover all changed hunks, adversarial cases, one novel attack and sabotage before setting verified.

## Deterministic acceptance

`make verify-E9-T22e`. The single submission target records the scoped native/Wasm gates, asset reproduction, actual production browser histories and independent byte audit, GPU/store regression attacks, the built demo and full local gauntlet. For the final pristine exact-head proof, run `python3 -B tools/verify/e9-gpu-journal-stream.py --output <fresh-evidence-directory> --cold-clone <fresh-clone-directory>`; the primary submission carries the once-run broad regression wall.

## Adversarial verification

Use a middle/tail payload mutation, stale competing writer, quota failure and exact resident-window overflow. Independently count and hash all reopened receipts and referenced payloads. Distinguish generated storage-boundary fixtures from an executed full guest: this slice makes no cold-Omarchy qualification or replay claim.

## Verification log

### 2026-10-22 — worker — ordered prerequisite from authenticated cold-boot failure

The fresh actual Daybreak capacity review is retained at
`target/evidence/e9-t22c-daybreak-capacity/report.md`, SHA-256
`a341f3ffc80ca87b347d97cc1ea6e2270323e1004e752fcd6db47a4a2f9d53ec`.
Its controller completed on requested/returned `gpt-daybreak-blue-latest` with
`daybreakBlue`, fallback disabled, no errors. Corrected original Omarchy attempt
3 rejected receipt 702 at transition `2207340032`: `67179533` lifetime envelope
bytes exceeded `67108864`, although the resident pending+candidate window was
only `524420`. All 256 block envelopes alone exceeded the lifetime bound. The
retained production store authenticates an exact durable prefix through 701;
this is a runtime prerequisite finding, not C qualification or performance.

Keep the original assets, pure ICount/64 cold profile, fixed 50M maximum
checkpoint gap, workload amounts and numeric budgets. Only this slice may enter
the active lane after its dependencies are verified. Prospective checkpoint,
witness-extension and storage limits are not waived; independently reproduce
any additional blocker and give it its own ordered S boundary. All PRs remain
open; no merge is authorized.


### 2026-10-22 — worker — activate bounded durable GPU journal

E9-T22c is blocked on the authenticated long-history boundaries and has left
the active lane. Its corrected clean-head full software phase and complete
source-sealed filesystem oracle pass; a separate fresh Daybreak phase audit
is pending and will not be represented as C verification. This task alone
occupies the active lane. Its dependency E9-T22b is independently verified at
`8b99d05a0e5b3ee23198e72ea9d4d324eb3e8744` and remains the production runtime.

Native branch `codex/e9-streamed-gpu-journal` continues the stack above the C
preparation layer; all 30 existing PRs remain open, draft, unmerged and
unqueued. Risk is high for durable recording/identity. Implement only the
writer/publication boundary here, with actual native-receipt browser proof;
whole-history reading, bounded replay and full original Omarchy qualification
remain their ordered tasks. Preserve every failed capture and avoid a
constants-only lifetime increase.


### 2026-10-22 — worker — bounded checkpoint-window design

Automatic approval review rejected a proposed removal of both cumulative
journal guards as weakening persistent resource limits. That edit did not
execute. Use the stricter bounded-window alternative: keep the existing
4096-row and 64 MiB counters/guards for each checkpoint interval, and reset
both only after successful durable checkpoint publication and native epoch
acknowledgement. A failed/aborted checkpoint leaves both counters unchanged.
The caller must capture an earlier lawful checkpoint before the interval is
full; it must not reset, discard or trim events at an ordinary flush.

The independent durable limits remain enforced: session-store.js has the
unchanged 4 GiB authenticated session closure, 2 GiB default physical retention,
4 MiB source chunks and 256 sessions; the Rust manifest validator retains
1 MiB metadata, 4096 index entries and 4 GiB session payload. This alternative
keeps all per-interval, pending and durable resource limits concrete. The
real native test will cross the old lifetime limits over multiple successful
checkpoint intervals, with all raw receipts preserved. No timing/full-desktop
or full-history replay claim is made in this slice.


### 2026-10-22 — worker — development proof before frozen submission

The bounded-window implementation preserves every numeric resident and durable
limit. Native UART offers cross 4096 lifetime receipts, and 256 distinct native
block completions cross 64 MiB of envelopes; each history is checkpointed over
legal intervals and reopened with all native rows/bytes retained. The independent
Python oracle imports no product codec, reproduces ordered durable rows and full
state/RAM commitment, and checks interval maxima. Existing publication-abort
proof now starts with a nonempty interval, keeps it unchanged on failure, and
checks zero only after a successful retry. Both overfull resident caller batches
(257 rows and 4,195,390 bytes) reject before publishing or changing counters.

Development commands: `node tools/verify/e9-gpu-journal-stream-browser.mjs
--development --output target/evidence/e9-t22e-window-development-2`;
`python3 -B tools/verify/e9-gpu-journal-stream-files.py --directory
target/evidence/e9-t22e-window-development-2`; the existing GPU replay browser
and independent oracle; `make web-dist`; and the new built-demo command. The
built page passed 127/0, zero console errors, both live pips, mutually disabled
controls during recording and a 390-pixel viewport without overflow. Desktop
and mobile screenshots are retained in the demo directory.

- `target/evidence/e9-t22e-window-development-2/report.json` SHA-256 `9c8b38223960ae8264adcd768d917534d90b1e28698cf2ced35cd45246148043`.
- `target/evidence/e9-t22e-window-development-2/independent-storage-oracle/report.json` SHA-256 `f82359e99610692a6120a31791613e21cb7728fc957d37d7457a9567d812d138`.
- `target/evidence/e9-t22e-gpu-regression-development-1/report.json` SHA-256 `14af8fcfb68f6fe45f8be49fcd8d3ada3751d83005af8e3b2b3ed3cc3b17322c`.
- `target/evidence/e9-t22e-demo-development-1/report.json` SHA-256 `2302a3b2093f476af9a534fd33b2b849ef8ad73a2b569260462b44cab0c0af42`.

All development failures and their executed sources remain retained. The first
independent parser incorrectly treated UART outcome queue depth as the constant
one; the corrected parser checks the actual queued depth. A source-sealed old
journal control still refuses the long histories even with the new lawful
intermediate checkpoints. No software/Linux/Mesa/full desktop, whole-history
reader/replay or performance result is inferred from the small storage guest.
Frozen primary, pristine clone, Daybreak adversarial and main-site proof remain
required before verification.


### 2026-10-22 — worker — disk exhaustion and incremental evidence recovery

Frozen runtime/source head `9835e6e1451b1dde2efccf1b7e5d7a6bcbabdfa2`
passed the first 15 direct submission gates. The real browser recording then
failed while writing progress.json with ENOSPC; its failed report and all
partial raw evidence remain in `target/evidence/e9-t22e-final-submission-1`.
The concurrent fresh checkout failed on unrelated historical recording
archives for the same reason; its failed checkout log remains in
`target/evidence/e9-t22e-cold-submission-1`. Neither is a passing proof.

The worker underestimated the full checkout size. The authoritative source
checkout already uses a source-complete sparse projection containing all
runtime, tests, tools, releases and named earlier evidence dependencies.
The cold wrapper now reproduces that same projection in a fresh no-hardlinks
clone, avoiding unused historical archives, while running every direct gate
afresh with scrubbed Rust/Cargo environment. This is not a later guest origin
or a shortened recording. The failed checkout is preserved as an environment
failure. Primary recovery may carry only the sealed successful prefix after
rehashing every previous evidence file and unchanged source and requiring
that intervening changes affect only this wrapper or task/queue metadata.
Any runtime/dependency change refuses that carry. The failed browser stage
and all subsequent gates, including the full wall not yet run, execute anew.

Space cleanup is user-authorized and recorded separately: completed compiler
intermediates only, plus byte-verified historical duplicate corpus copies.
No unique raw evidence, active source, current build or release is deleted.
This evidence/harness response does not change the submitted runtime.


### 2026-10-23 — worker — frozen high-risk submission complete

Implementation/runtime remains frozen at
`9835e6e1451b1dde2efccf1b7e5d7a6bcbabdfa2`; the final accepted harness/source
head is `03ce37a31f740a0b7d18a60d7461425c5848cc86`. The recovered primary
submission passed all 22 command gates, carrying exactly 15 earlier successful
gates only after source/evidence authentication. The interrupted browser gate
and all subsequent gates ran anew. The fresh no-hardlinks, source-complete
pristine clone ran all 25 direct gates afresh, with no resumed prefix, scrubbed
Rust/Cargo environment and a clean final checkout. Previous ENOSPC captures
and the unfinished first-cold report remain explicitly non-passing evidence.

Commands: `python3 -B tools/verify/e9-gpu-journal-stream.py --output
target/evidence/e9-t22e-final-submission-2 --resume
target/evidence/e9-t22e-final-submission-1`; and `python3 -B
tools/verify/e9-gpu-journal-stream.py --output
target/evidence/e9-t22e-cold-submission-2 --cold-clone
/Users/blamy/Documents/Codex/.e9-t22e-cold-03ce37a31`. The full local wall is
recorded once in the primary. Raw `make ci` stopped on exactly the same five
historical quarantined zicsr-stub dead-code diagnostics; the exact narrow
waiver and the entire remaining local native/Wasm/features/RISC-V/determinism/
performance-smoke wall passed. Strict production and affected-target Clippy
passed without that waiver. This is not an unqualified raw make-ci exit zero.

The recorded production GPU machine executed two literal small RISC-V guests: the
count history retains 4,359 receipts including 4,100 native UART offers; the
byte history retains 260 receipts including 256 distinct native 256 KiB block
completions, totaling 67,125,819 envelope bytes. The independent parser
authenticates 380 physical chunks and 346 logical objects, all rows and
references, initial/final bindings and both complete native/RAM commitments.
Intervals peak at 2,311 rows / 33,562,910 bytes. The nonempty publication-abort
case preserves 1 row / 1 byte, native/RAM/manifest prefix and revision 25;
successful retry alone resets both counters. Existing guard, ownership,
quota/crash/race and real physical-GPU replay tests pass. The built demo is
127/0 with no console/HTTP errors, live pips, coordinated controls and
desktop/390-pixel captures with no horizontal overflow.

Fresh actual Daybreak evidence-only charter held P1-P15 with no failed
prediction or runtime contradiction. Its novel forced-failure/double-dispatch
UI attack confirms a single probe call, regressed pips, restored controls and
testHooks-only exposure. The source-sealed oracle passes original evidence,
rejects a valid-JSON tail-row mutation and corrupt/missing tail content, and
returns identical passing digests after restoration. It retains the permanent
verify target, independent oracle and GPU/store regressions. Its P16 remains
nonterminal: it deliberately did not inspect the then-running wall or actual
main site. A NEW fresh Daybreak gate-closure reviewer must bind the now-frozen
wall and carry unchanged local results; a later main-publication reviewer must
close the remote gap. Only the verifier may set verified. No original Linux/
Omarchy qualification, whole-history read/replay, performance or Epic 9
completion is claimed by this storage boundary.

- `target/evidence/e9-t22e-final-submission-2/report.json` SHA-256 `999bacd3fbadabeddb1d9efeb91ae6cb71ab5e781d7db7a403ec3632c653566c`.
- `target/evidence/e9-t22e-final-submission-2/gauntlet/report.json` SHA-256 `9888c001ac69f3a1cd147f8974cbe0c8c0058d11cc024a8dc168323f588104b4`.
- `target/evidence/e9-t22e-cold-submission-2/report.json` SHA-256 `40a10d5efc9bd30472bb303e1a292979c1ae91edff49f35b75eda1d8c9109e20`.
- `target/evidence/e9-t22e-daybreak-full-charter/report.json` SHA-256 `30a51d650192f11e2d3588d64d473035c748c387ba9241ae498388573b983459`.
- `target/evidence/e9-t22e-daybreak-full-charter/routing.json` SHA-256 `4084f30a40170067cc5499e575e0566836034e5075467498fa3ed7b2ef7d6b02`.
