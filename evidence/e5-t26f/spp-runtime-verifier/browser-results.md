VERDICT: refuted

The original post-restore timing criterion is **FAILED**: `4104.174999952316 ms > 2000 ms`.
Reached functional and provenance predictions are HELD within the limits below. This is a
bounded diagnostic review, not F verification or a runtime-correctness refutation of N.
No task/status change is made.

## Record and independent audit

Reviewed only the original closed cold/reuse pair in
`evidence/e5-t26f/single-process-observer-96ecb801/` and its retained baseline. Separate CPU or
latency diagnostics were not read or run. All times below are browser milliseconds unless UTC
is explicit. `R` below means
[failure-post-restore-interaction-checks.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-96ecb801/reuse/failure-post-restore-interaction-checks.json);
`C` means
[diagnostic-checkpoint.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-96ecb801/cold/diagnostic-checkpoint.json).

- Frozen plan SHA-256: `7443316d6f0d9a8615ae8c548f8e78eb16be65d7f362c19bdd8cf8d97a93596b`.
- R SHA-256: `a25418d4dd387ae10af687e8cfffb615a3a74eb6bc1bd81aea88a50e10dfef96`.
- C SHA-256: `350c79b7776952338c89111fe91ce14e0b2fd51c923a04707eb6edbea6bab77c`.
- Collector SHA-256: `4ec0d9f80286aa6feaa76e9c20c3b60224108daa49e31f1b7d48457a7e3d8c5f`.
- Offline [audit.mjs](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/spp-runtime-verifier/audit.mjs)
  SHA-256: `8e80a01d43dced6022dd6a948bb26733204e516d92e81dead0f0bb324e75fa06`.
- [audit-result.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/spp-runtime-verifier/audit-result.json)
  SHA-256: `a176c3c7a9ded9cb415698537a8818fcc0b639af5e59076708dee5d7c98e282c`.

Command: `node evidence/e5-t26f/spp-runtime-verifier/audit.mjs` — exit 0. This parser hashes
actual bytes, independently decodes the envelope/sound section and computes counter arithmetic;
it neither imports the collector nor executes the browser harness. Its result retains all input
digests, all 17 source pins, complete runtime/seed hash-tree entries, raw endpoints, and citations.
Inputs, source pins, runtime tree, baseline tree and HEAD were rechecked before output.

## P1–P2 — HELD: provenance, new cold seal, isolated reuse

Current and recorded HEAD is `96ecb801fdf8b67af75cd150db82d115bcf046cd`, branch
`codex/e5-t26f-spp-browser-proof`. The committed plan equals the actual plan byte-for-byte.
N's verified commit `ba9910ab0bec9029368376888a34a629620c7dbd` is an ancestor, committed at
19:53:27 UTC, before F activation at 19:59:12 and cold startup at 19:59:44.636.
N's committed/current verdict digest is
`3fad1a68f5bcd41987f9b6c2c1d43ceb1225c6016dbb0239af82ce6755a222a3`.
Since that verdict, committed changes are evidence/task metadata, generated task JSON, and the
dist service-worker build-version literal, not a new semantic runtime change.

Independently hashed bindings agree across invocation, both children, owner and collector:

| Actual bytes / binding | SHA-256 |
| --- | --- |
| Both `web/pkg` and `web/dist/pkg` WASM | `84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d` |
| Served runtime tree, exact runner filter, 150 files | `65935dd0535eb38ed23d78956f63ec800daf3f6bb63094c9c694e236786f74e1` |
| Kernel, 24,208,896 bytes | `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce` |
| Held image, 1,073,741,824 bytes | `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72` |
| Chunk manifest | `e02a9af547773f9d54e47151419ab3b118c55d3a4c90b25dcc434487db8dc9f5` |
| Closed baseline tree, 812 files | `275b4febbd10b186f9c2b34c85dbb346880de86f1e0522878c450ce25289a51f` |
| Actual desktop envelope, 2,808,262 bytes | `b9eac0eb045945eed648c90537a9e11819e882b7f4c57fb3bd2b9690513fce49` |
| Owner file | `42e44306078f7d02c41c9b95c71dfaeb974bb73c2f001efbd60078a800ac6951` |
| Checkpoint file including actual session bytes | `62d22907aeb73fc71e2a5b573e2f756fcd404292759c64e26671c25c7cdaf580` |

The proper runner remains `7f8b58f7e3f6e0f16b7b6cb91b8593e625ed058e7aa764df428e9990f85100a1`;
wrapper remains `3be35665f7d403f9c291b5b81b1c07449ef526d171a53f5e7a69b087e79c416d`.
All recorded helper/C/binary/build-info/fixture pins authenticate current bytes. Image readback
and observer safety remain carried HELD proofs; no image rebuild, extraction or test was rerun.

Freshness is supported by the authenticated create branch's new-output/new-temp/empty-profile
guards and actual cold phases, not merely by changed hashes. Desktop readiness was
20:07:16.362 UTC; two windows were ready at 20:12:47.951. Initial playback completed with
1440 written/inspected/non-silent frames, maximum `0.082000732421875`, output attached
(C:106, C:129). The initial generic pre-play sample reports 4096 inspected/written despite zero
indices; it is not the explicit zero-baseline check used after restore.

Cold paused/coherence checks passed with saved CRC `168fc7fa`, overlay generation `627`,
`isPaused=stillPaused=true`, `decision=resume`, and matching envelope (C:260, C:271).
Checkpoint creation was 20:13:21.441 UTC; reuse began at 20:13:22.751. The new retained root is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-oBnSX1`.
Cold used `checkpoint-profile`; reuse used `iteration-nFA2eW/profile`, a new copy authenticated
before launch by runner:235–240. The baseline still hashes identically; no old seal was rebound.
The already-executed copy is not expected to hash like its pre-execution seed.

Saved browser identity is Chromium `Chrome/152.0.7977.76`, headless true, origin
`http://127.0.0.1:61637`. Reuse reaches phases after the actual browser-identity equality at
runner:1511. Its failure JSON omits a duplicate browser field; do not call that an independent
serialized reuse identity receipt.

## P3 — HELD: same fresh prepared player, with guard-mediated identity

I viewed both original PNGs, not merely their reported hashes:

- Cold PNG: `f7f0f305d33859b60b6490c2f6adddd8ca4e37c3b247192439741851c16ada03`.
- Reuse PNG: `913dab5f0fc7db289baa3c3e94a98db60f5b78d96a4e4bb2fba4d9cbba494c7a`;
  byte-identical to `post-restore.png`.

Both pre-1/pre-2 and restored post observations show **PID 999, starttime 28938**,
`/usr/bin/aplay(inode-match)`, `pipe_read`, FIFO FD3 flags `0100000`, readonly1,
parent FD3 flags `0100002`, child-writers0; PCM FD4 owner999, PREPARED, hw_ptr0/appl_ptr0.
Cold shows the two terminals and green prepared marker. Reuse shows typed `play`, matching
post identity, green `e5t26f-aplay`, `[1]+ Done`, and a returned shell prompt.

These are manual PNG transcriptions. Parent PID, inode numbers and the complete private
`e5_seen` result are not printed. Their equality is supported by the unchanged held C/helper
guards, including parent=`$$`, not invented numeric identities. The green completion is
conditional on exact saved observer-result equality, finite 3840-byte stereo feed, writer
close and successful wait for that same child (`e5-t26f-resident-observer.sh`:113–135).

Actual envelope magic/version/length/trailer and all four section digests validate. Sound
payload at byte offset `2807998`, length184, hashes to
`42dfc147f4ad0d0b98490c3cb39bb8f3932f785a8266335fcd151de18b56858f`.
Independent decoding matches the recorded state: PREPARED2, params1, request257, stream0,
buffer3840/period1920 bytes, channels2, format5/rate7 (S16/48-kHz), zero pending transfers/bytes,
release/XRUN/events/reset, and four zero kicks. No historical sound hash or player ID was used
as the expected fresh result.

## P4–P5 — HELD: unchanged policy and reached normal functionality

Both raw child configurations and source pins support the default physical `play`, 5-ms edge
pacing; no command, CPU/guest-PC/latency sampler, guest-clock/divider, budget or COMPLETE override.
The wrapper scrubs E5/CARGO/RUSTFLAGS/RUST_LOG. Outer `env -u RUSTDOCFLAGS` is Main's supplied
launch provenance, not a raw full-environment capture. Both endpoint states retain JIT enabled,
decoded4096, repack-off24, compile queue256, and entry-cost timing disabled with zero timer reads.

The first normal present matches CRC `168fc7fa`, full repair, fresh HELLO generation2/version1,
and whole-machine resume; boot states are fetching133 → instantiating153 → restored771,
**no booting**. The one agent-channel diagnostic explicitly requests fresh HELLO; it is not a
reboot. Display checks pass (R:170–289), not the later overall normal-restore checks.

Two explicit samples at `1485.7200000286102` and `1841.6050000190735` show locked/suspended
audio with every measured PCM counter, index and maximum zero (R:373).
The fresh tablet frame maps normalized `(17510,16056)` to guest `(684,392)`; rendered cursor
matches94 pixels at `1947.554999947548`, elapsed `769.7099999189377` (R:407).
Focus is accepted and guest-visible, linked to the subsequent command (R:918).
Physical `play` plus Enter generates ten matching key/DOM edges, no repeat injection,
frame4→10, marker true, red marker false, and8459 changed pixels (R:447).

Immediate completion PCM at `5255.90499997139` (elapsed `4078.0599999427795`) has
**1440 written, 1440 inspected, 1440 non-silent** frames; write/read1440, fill0,
capacity4096, maximum `0.999969482421875` (R:466). Output is attached at
`5279.919999957085`; audio is unlocked/running and rendered frames advance41152→200128.
Final input has three pointer frames, ten keyboard frames, no held buttons. These establish
freshness and completion, not bit-exact payload duration or exact first audio arrival.

## P6 — FAILED: original 2000-ms endpoint

`R.milestones.normalRestore.result.completedAt` (R:173) equals `postRestoreStart` (R:291):

`5282.0199999809265 − 1177.8450000286102 = 4104.174999952316 ms > 2000 ms`.

The end is the frozen `postRestoreEnd` (R:505), not the later interaction reading
`4104.549999952316`, nor a marker/PCM timestamp. Raw error at R:599–603 is
`AssertionError / ERR_ASSERTION / post-restore interaction exceeded 2 seconds`, exact point
`tools/verify/e5-t26f-browser-roundtrip.mjs:1930:12`. Reuse log records the failure at
20:13:31.762 UTC after command/audio completion. Cold exit0 and reuse exit1 have null signals.
Outer0 is the collector's accepted failure-record path, never a passing F result.
Demand: retain this failure; a passing original cap still has to be demonstrated.

## P7–P8 — HELD boundaries; later coverage and full acceptance NEEDS EVIDENCE

`normalRestore.checksPassed=false`, `coherenceAudit.status=deferred` (R:237, R:289).
The saved generation627 and cold coherence check do not prove later loader admission:
reuse receipt fields `snapshotDecision`/`overlayGeneration` remain null. The fail-fast cap
prevents the normal coherence audit; drag-phase saves, second reload and no-stuck hover are
unreached. Full reuse browser/HTTP error arrays are absent. Empty presentation-local errors
and the cold's empty arrays cannot fill that gap.

Independent arithmetic matches the collector, using raw `jitBefore`/`jitAfter` (R:292, R:517):

| Counter | Before → after (delta) |
| --- | --- |
| Guest retired / JIT retired | 6493934→56971163 / 2198731→21368225 |
| Executed blocks / direct-chain entries | 180173→1531470 / 419139→4030580 |
| Dynamic attempts / hits / refusals | 88751→619666 / 846→27639 / 87905→592027 |
| Builds / evictions / retranslations | 11890→696348 / 0→91 / 0→248 |
| Discovery nominated / deduped | 270→3099 (2829) / 566027→4058491 (3492464) |
| Discovery depth / generation | 0→32 / 5→5 |
| Queue admitted / backpressure | 270→1781 (1511) / 0→1907 (1907) |
| Queue popped / cancelled | 104→912 (808) / 0→0 |
| Queue depth / high-water | 166→248 (82) / 222→256 |
| Submitted members | 104→652 (548) |

Staged `2829−32=2797`; conservation `2797=82+1907+0+808`.
Popped-unsubmitted `808−548=260`; incoming-rejected `2797−1511=1286`;
resident-displaced `1511−82−808=621`; `1286+621=1907` backpressure.
Discovery stale/overflow/exhaustion counters are zero at both endpoints; decoded discards0,
flushes4→4. Dynamic attempts equal hits+refusals at both points; live entries1→0.

These are safe, unsaturated, same-generation job/lifetime counters, not unique PCs or a cause.
RPC request/receive windows are `1444.2849999666214→1463.8199999332428` and
`5282.850000023842→5325.929999947548`: sequential completed-pump observations, not the exact
F interval. Popped-unsubmitted is pre-submission refusal, not demonstrated compilation failure.
No speedup, causal attribution or sampled first-arrival claim follows.

Carry N's independently verified five cached-equality bits `{1,3,5,7,8}` and guest SRET/pending
interrupt safety; live CSR authority and clocks/budgets remain outside that projection. Carry
unchanged observer/image/helper HELD boundaries. N and those historical proofs were not retested.
Prior F timing failures remain failures. No production code, task metadata, index, HEAD or
profile was modified, and no browser/build/clone/sampler was launched by this audit.

`acceptance=false`, `fVerified=false`. Even a passing diagnostic screen would not suffice:
**a complete normal, non-diagnostic `make verify-E5-T26f` run and independent frozen-head review
remain required**. Main owns any next diagnostic decision. This bounded audit is closed.
