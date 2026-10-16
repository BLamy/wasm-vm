VERDICT: verified

Independent verifier for E6-T11a; no implementation edits. Runtime/harness frozen at
`252b5eaba8135967c29938e7a5a4709c4d22473d`, compared with `0b7c9341`.
Worker submission `97c93b71`, log correction `6d1e7a7e` change evidence/status only.
All inspected runtime files still equal the frozen Git objects.

## Predictions and falsification

Original preimplementation predictions SHA-256 is unchanged:
`f0b28f69fca2185a9872733b4d27b4ea314c928736d58d8fc846b6f67b5e1aab`.
Supplemental P16 records the implementer's disclosed development correction; it is
not claimed as an independently discovered defect. P17 was recorded before its
independent execution. There are no FAILED or NEEDS EVIDENCE predictions.

| Prediction | Result and concrete evidence point |
| --- | --- |
| P01 production gating | **HELD.** Worker hardware records `default-context-disabled` and `unnegotiated-context-disabled`; ordinary constructor has VIRGL bit clear, capsets zero, no callback. Default-demo/live reports show the proof export absent and 127/0. The actual fetched ordinary Wasm hash is `75f405e190d96382f52d12906bd32f3ffdaf6ade3262438673c7f8e6d4ac0ed8`. |
| P02 real queue to owner ordering | **HELD.** Worker has 27 byte-identical native/Wasm request, response, full descriptor/avail/used-ring and transport-state records; 165 hardware wire commands. Independent records 0–2 create context, allocate an actual 96-byte GL buffer, and attach through real Machine RAM/MMIO. Callback omission is rejected by the worker's actual renderer-context oracle. |
| P03 exact packets/splits | **HELD.** Native worker boundary tests cover the distinct fixed layouts and SG arithmetic. Independent four-descriptor requests split fields differently; final native test additionally rejects extra destroy/context-resource/unref bytes and short backing prefix. `fixed` accepts only exact aggregate readable length. |
| P04 full reply preflight | **HELD.** Worker rejects capacities 1–23 without writes/callbacks and zero-length descriptor before service. Independent three-seed `23-byte response no mutation` records preserve both owners and recover on the same context ID. |
| P05 metadata/IDs | **HELD.** Recorded native metadata/error/budget tests and hardware malformed-field cases reject before sink entry; independent context padding/name/flag/ring attacks and actual GPU allocation failure preserve public state. Resource profile remains the bounded verified renderer profile. |
| P06 shared names/generations | **HELD.** Native and hardware `2D-cannot-steal-3D-id`, inverse collision and both reuse directions preserve 2D fence behavior. Independent stale-generation unref fails after fresh allocation of the same numeric resource ID. |
| P07 ownership/lifetime | **HELD.** Independent three-seed lifecycle keeps a real retained buffer alive across context destroy and public unref, creates a distinct replacement, then deletes only the retired buffer when its lease releases. Worker repeats this with actual textures. |
| P08 RAM SG validation | **HELD.** Worker overflow, MMIO/out-of-RAM, zero/excess entries, padding, short list and quota cases fail atomically. Independent invalid final segment and wraparound fail; overlapping and three-byte short aggregate succeed. Native tests repeat with three asymmetric seeds. |
| P09 initial copies/aliases | **HELD.** Independent records 3, 24 and 45 alias writable reply memory with ordered overlapping SG entries. Resource-store bytes equal the original asymmetric sentinels even after reply publication and later RAM overwrite. These are initial copies, not future DMA. |
| P10 expected failures | **HELD.** Independent records 66–69 prove real second-owner context rollback and actual buffer-allocation failure/retry. Final native test injects a structured pre-apply sink failure for every supported operation, checks unchanged transport bytes/event count, then retries successfully. |
| P11 uncertain outcomes | **HELD.** Worker exercises throw, Promise, getters, malformed results and every error mapping; getters remain uncalled. Independent record 63 applies creation then throws: wire ERR_UNSPEC, unchanged nextGeneration and poisoned Rust; record 64 invokes no sink. Native diagnostic/error mappings and poisoned suppression also execute under LLVM coverage. |
| P12 reset | **HELD.** Independent records 65, 73 and 77 demonstrate reset recovery, old-owner disposal and epoch separation. Worker reset/cleanup faults keep the bridge poisoned; final native reset-error case also remains poisoned until a successful later reset. |
| P13 snapshots | **HELD.** `native-coverage.log`, test `pending_command_survives_every_snapshot_refusal_without_quiesce_or_fallback`: seven save/restore refusals preserve all 4 MiB RAM, architectural digest, transport bytes and callback count with a pending valid queue kick. Includes valid legacy resume, malformed restore and desktop missing-device fallback. The next instruction completes the preserved command exactly once. Worker also exercises direct desktop backend denial. |
| P14 scope/regressions | **HELD.** Four existing GPU Machine and 80 GPU unit tests rerun under instrumentation; worker also passes six Wasm protocol tests, default builds and ordinary page/live 127/0. Unsupported submit/transfer/capset operations fail. No draw, scanout, DMA, Linux Mesa, asynchronous fence or throughput claim follows. |
| P15 provenance/coverage/sabotage | **HELD.** `audit.json` passes 1,631 checks over exact Git sources, served bytes, all receipt-linked files, native/Wasm parity, browser errors, clean clone and live binary. Detailed coverage classification follows below. Independent omission/highwater sabotages both fail at intended oracles. |
| P16 applied-then-thrown creation | **HELD.** Independent records 63–65 preserve uncommitted generation across failed callback, change epoch on reset, then accept the same generation in the fresh epoch. Replaying the old event fails. Preserving the old JS highwater deliberately changes the retry to ERR_INVALID_RESOURCE_ID and the test fails. |
| P17 raw callback arrays/host diagnostics | **HELD.** Across three seeds, retain the actual debugName/segments.data objects, call exported Wasm memory.grow(1), assert the former memory buffer detached, and verify original arrays and literal contents survive growth and RAM overwrite. Independent records 71/75 exercise each owner missing on teardown and poison; record 78 follows revoked-Proxy normalization failure with valid work. |

Independent hardware result: **645 assertions, 44 attacks, 79 wire records**, zero
console/page/request errors and zero final GL objects. `browser-report.json` JSON
pointers `/variants/0/result/records/N` use the zero-based record numbers above.
The native verifier has four deterministic tests in its separate `native/` Cargo
package; its sink proves transport only. Actual GL evidence comes from the browser.
Worker, independent and live screenshots were inspected.

## Coverage against every changed hunk

`coverage-review.json` enumerates all 40 textual hunks and every changed line in
five core runtime files. `native-coverage.json` contains actual LLVM 22.1.2
segments from the four independent tests, seven worker control tests, four
existing Machine tests and 80 GPU tests, all using an isolated instrumented build.
The five files have 834 changed lines: 552 have nonzero measured ranges, nine have
zero ranges classified below, and 273 have no compiler region (declarations,
comments, attributes, match alternatives and punctuation). Those noninstrumented
lines are structural parts of the measured implementations, not extra behaviors.
`control3d.rs` measures 27/27 functions and 424/430 executable lines; this is not
claimed as complete branch or generic-instantiation coverage.

The combined worker and independent precise CDP recordings have **no uncovered
non-whitespace innermost range** in `control-bridge.mjs` or the new `inline1.js`
callback validator. The independent tests fill revoked-reflection and both
structured context teardown outcomes. Unchanged inline0 JIT functions are outside
this task. Existing resource/state/decoder source hashes are unchanged; earlier
HELD resource/state/draw proofs carry forward, and this recording directly tests
the newly connected owner lifecycle.

Narrow native waivers (all recorded explicitly in the coverage census):

- `control3d.rs:538`: exhaustive fallback for the private u32 opcode match. Its only
  caller routes exactly the supported opcode set; shared backing/unref routes only
  IDs found in the 3D map. This is a fail-closed type/dispatch defense, not an
  unimplemented guest operation or semantic fallback being accepted as a feature.
- `gpu/mod.rs:1582–1584`: response-write failure after full validated RAM capacity.
  The queue validator and new preflight establish every span before the callback;
  the synchronous callback cannot reenter/mutate the Machine (independently
  attacked). Retained generic bus-error handling is defensive, unreachable through
  the accepted RAM-only path.
- Remaining zero whole-line markers (`desktop_restore.rs:604`, `control3d.rs:329`,
  `lib.rs:2152,2265,3143`) are closing braces after returns/checked overflow paths.
  They introduce no untested operation.
- `control3d.rs:334,407,498` protect u64 generation exhaustion; reset's checked
  epoch increment likewise protects exhaustion. Neither counter is externally
  writable, and reaching overflow requires approximately 2^64 accepted operations.
  This is bounded counter defense, not a silently omitted normal state transition.
- Allocation-error tails at `406,411,417,458,497,563,587,592` handle host allocator
  exhaustion of already bounded vectors. Guest quota failures and host renderer
  allocation failures execute; process heap exhaustion itself is waived.
- Error tails at `515,549` repeat the same public-resource lookup already required
  by dispatch, `527` rechecks immutable accepted metadata, `567` reads an entry
  after exact list/range validation, and `596` copies a prevalidated RAM span with
  exclusive bus ownership. No guest/callback mutation occurs between these checks.
  These are redundant fallible API defenses; ordinary rejected inputs do execute.

Other runtime hunks: Cargo feature gates and protocol constants are exercised by
both default/proof native/Wasm builds, literal packet cases, and absent ordinary
proof exports. The complete Wasm wrapper is covered by recorded API scenarios:
both constructors; every marshalled event and callback result class; copied RAM,
layout and diagnostics; all six reentrancy guards; malformed addresses; bounded
read/write/MMIO rejection; real queue execution; and both populated/empty maps.
Native LLVM does not measure Wasm Rust, so no native hit-count claim is made for
that wrapper. Its remaining defensive error conversions are narrowly waived:
Reflect::set failure on newly created ordinary objects or host OOM, radix parse
failure after exactly 16 valid hexadecimal digits, no GPU slot/seed-RAM failure
in a newly assembled fixed 4 MiB Machine, MMIO bus failure after fixed installed
slot/alignment/range checks, and GPU RefCell contention after the enclosing
Machine borrow already excludes reentrancy. None is guest-controlled host code.

Harness/documentation hunks: the Make target, shell gate, browser/default-demo
launchers, receipt and cold-clone tools all ran from the frozen head and clean
clone. Their success/failure outputs are independently rehashed; sabotage proves
the new ownership oracle notices omission. Constants/types/README/logging are
waived as declarative. The generated ordinary Wasm and service-worker version
were built, served, hashed and tested locally and on the deployed page. No changed
reachable acceptance behavior remains unproven; no runtime fix was requested.

## Evidence, environment and permanent suite

`audit-evidence.py` independently verifies worker receipt
`1ca99fe2a1b9ef5fb0d779a09749b3ad7170101b4578cef584b3528b296cc5c8`, cold receipt
`8a5cb66d7144520e797a36a344729b7e08ea3ada82584ebaaf347928ddc6af9c`, and exact clean
checkout status before/after the same gate. Build override variables were scrubbed.
The real hardware browser is headed, reports enabled WebGL and lacks software
renderer flags. Fault wrappers deliberately return failed allocations or mutate
trusted owner state; they do not supply replacement renderer semantics. Expected
wire bytes and SG sentinels are literal, independent of production encoders.

Promote the verifier-owned native package, browser cases and replay/audit scripts
as deterministic regressions alongside the worker `make verify-E6-T11a` target.
Keep the recordings, screenshots, hashes and coverage census. Compiled targets
and raw compiler profiles are explicitly ignored and are not committed. Raw
profiles can be regenerated by the script; the source-bound exported counts and
binary/profile hashes remain in the committed evidence.

Reproduce from the repository root:

```sh
node evidence/virgl-control/verifier/run-browser.mjs
bash evidence/virgl-control/verifier/run-native-coverage.sh
python3 evidence/virgl-control/verifier/audit-coverage.py
python3 evidence/virgl-control/verifier/audit-evidence.py
```

Runtime evidence remains scoped to proof-only synchronous control/resource
ownership. There is no production 3D enablement or live Linux guest workload claim.
