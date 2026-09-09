# E5-T26p independent compiled-artifact verdict

**ARTIFACT GATE: GO — proceed only to retained-baseline semantic evidence.**

This is a read-only static-code adjudication against the predictions frozen in
`verifier/plan.md`. I did not run a build, test, probe, browser, clone, sabotage, broad gate, or
prior-F proof. I independently inspected the full owned runtime diff, raw AArch64 and production
WASM disassemblies, binary-derived function index, build records, and naming bindings. This is
not an architectural-effect, callback-payload, speed, or latency verdict.

Evidence-index SHA-256: `dc53ee61a9caa4e6d93c72617b2ab94f8e7c044bab395a19737db7edf0a08d07`.
Its generator SHA-256 is
`e7811e28fa042959e36bb8396df94dd3b5b7b859497b0d5b691e1844b9a9d363`.

## A1 — HELD — reproducible identity

- The matched probe records bind both sides to source
  `d7d308a58825e6856db532822e36e1681230027a`, builder
  `6f6def3bd84a87673d1cd5f1133c2b26eead2d4e345def14c293a8b4659cddd6`, Rust/Cargo
  1.96.0 (`ac68faa20c58cbccd01ee7208bf3b6e93a7d7f96`, LLVM 22.1.2), wasm2wat
  1.0.41, release CGU=1, identical commands/features, probe source
  `2e3a3cd6c8f50cff88a57da2783c058849e529af0affb22d21a68d4f9b181ba5`, and pruned lock
  `82b300ce814c8742002c86b733ebd60c7e344fbec6cd228c04eb0ff760d408b3`
  (`artifact-{baseline-d7d308a5-r2,candidate-d7d308a5-r1}/result.json:5-26,41-123`).
  The earlier baseline directory without archived toolchain/config is excluded.
- Candidate runtime hashes are Hart
  `ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39`, core lib
  `9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053`, and Wasm lib
  `676941521e8882e17b242384ce7d2a737918750b46ec6b302f120d5cfaa92034`; the three-file
  runtime diff is `f941c441bd0be5938a45abd9db36994be5ee451f999894e42cdd37581ccfe989`
  (`production-candidate-r1/result.json:2-26`). Baseline core hashes are
  `c3b4fc40bc3240de652a510efc5dd5822c79e02c41664324c2fbb6a2419653ad` and
  `7ff782fec3aa18b1b3729ac57e96dd999162b5c92b6fa36ef080cd9953bc2d3c`.
- Native binaries are 868,936 bytes,
  `fdd9c6a82272499a1d68a272c50e93799cf44b7744915b0980fb81a57a9e4913`, and 885,768
  bytes, `53d3793e0d03808ea646113cf577e0397d1d7a1248d0b521eb095a9f02155215`.
  Raw disassembly digests are respectively
  `e18483c4b43bb36f99a2019371406232723a56f694e7aa360590fc01e01b2749` and
  `9b806f69c604a7716166c61fdaad92e5dd4e136861668b31cc4f4c41f93d4f6b`.
- The retained production baseline is the pre-candidate artifact built by normal
  `wasm-pack build crates/wasm --target web` (`e5-t26o/main-gates/02-web-dist.log:1-14`), with
  no core/WASM source delta from its verified runtime head to `d7d308a5`. Baseline release is
  1,549,483 bytes,
  `20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238`; candidate is
  1,555,346 bytes,
  `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`
  (`production-candidate-r1/result.json:13-37`). `name-release.mjs` SHA
  `07f36a59f3592c4fda63e0ba5879942c64781d02718bec3c35bcd363d88b4ba6` authenticated all
  eleven non-custom sections of each named module against its exact release; named module hashes
  are `4a234e51b53935d24b743278a58ba2bfa958625cef40ee087185846c9b6d7407` and
  `0e99527f97e665b98a5f7fe5710d2075818e4f9f0875aa51ef746894f66ee44f`.

## A2 — HELD — actual caller-to-callee reachability

- Native direct Hart: baseline probe line 7072 calls execute at `0x100007708`; candidate line
  9191 calls unit `step_with_capture`, whose execute call is `0x100002410`. Recording remains a
  distinct candidate chain: line 9165 to recording step at `0x100009708`, then recording execute
  at `0x10000255c` (`artifact-index.json`, native function entries).
- Native actual `Machine::run`: baseline body line 43971 calls ordinary step at
  `0x10002c14c` and cached execute at `0x10002c4d4`; candidate body line 45761 calls ordinary
  unit step at `0x10002dd50` and cached unit execute at `0x10002df58`. Candidate recording
  Machine code remains separately reachable; its cached execute call at line 9865 is
  `0x10000a1b4`.
- Production WASM: baseline `WasmLinux::run_chunk` function 266 calls Linux-specific
  `Machine::run_traced` 192 at `0x088cd3`/`0x088ce9`; function 192 calls execute175 on ordinary
  and cached dispatch at `0x043319`/`0x043463`. Candidate `WasmLinux::run_chunk` 269 calls actual
  `Machine::run` 183 at `0x08bfb7`/`0x08bfcd`; function 183 calls unit execute175 at
  `0x029d67`/`0x029f71`. Candidate recording `Machine::run_with_capture` 187 calls recording
  execute174 at `0x034f2c`/`0x035218` and its other capture specialization execute176 at
  `0x0350be`/`0x03549a` (`release-*/disassembly.txt` at the indexed lines).

These are linked native bodies and the authenticated production WASM module, not constructor,
symbol-reference, or probe-WAT substitutes. The probe wrappers only anchor public reachability.

## A3 — HELD — mandatory unit-path elimination

- Native baseline execute's common success tail writes retirement value, rd, memory address/value,
  and width through the return pointer at `0x100003e0c`, `0x100003e10`, `0x100003e14` (`stp`),
  and `0x100003e18`, then the result discriminant at `0x100004300`
  (`artifact-baseline-d7d308a5-r2/native-disassembly.txt:3441-3450`). Candidate unit execute
  writes architectural PC at `0x1000042c8`, returns success tag 16 in `x0` at
  `0x1000042cc..0x1000042d0`, and has no tuple return-area stores
  (`artifact-candidate-d7d308a5-r1/native-disassembly.txt:3746-3753`).
- The actual Machine cached boundary confirms this independently: baseline prepares return area
  `sp+0xb0`, calls at `0x10002c4d4`, then reads tuple/result fields at `sp+0xd1` and `sp+0xb0`
  (lines 45016-45025). Candidate passes Hart/bus directly, calls at `0x10002df58`, and compares
  register result `x0` with 16 (lines 46715-46722). The ordinary calls route to their corresponding
  recording/unit step bodies at `0x10002c14c` and `0x10002dd50`.
- Production WASM baseline execute175 success tail has six output stores: tuple fields at return
  offsets 32, 24, 16, 8, and 0 plus discriminant 33 (`release-baseline-d7d308a5/disassembly.txt:
  23291-23316`, `0x01081c..0x010853`). Candidate unit execute175 has only the legitimate
  `Result<(), Trap>` success-tag store of 16 at return offset 0 (`release-candidate-r1/
  disassembly.txt:23240-23245`, `0x01077c..0x010780`). Its architectural PC store at Hart offset
  3080 remains. Ordinary/cached callers subsequently inspect only Result state at
  `0x029d6a..0x029d74` and `0x029f74..0x029f7d`; no retirement tuple fields are consumed.

Legitimate trap cause/tval return storage remains and is not counted as failed elimination.
The evidence establishes eliminated generated retirement-return work, not fewer executed
instructions or faster execution.

## A4 — HELD — recording positive control

- Native candidate recording execute is a distinct 9,200-byte body. At cached Machine call
  `0x10000a1b4`, `x0=sp+0xb0` supplies an output area and the caller immediately reads its
  discriminant/tuple at `sp+0xd1` and `sp+0xb0` (lines 9858-9868), unlike the unit call above.
- Production WASM recording execute174 stores rd/value/MemOp representation at return offsets
  8, 0, 9, 17, 25, and 32 (`release-candidate-r1/disassembly.txt:16124-16155`,
  `0x00ce16..0x00ce4d`). Function187 reaches it on ordinary/cached paths at the addresses in A2.
- Source routing makes `Hart::step_traced` select `RecordingCapture` at Hart lines 801-806 and
  `Machine::run_traced` select `RunCapture::Traced` at core-lib lines 3855-3863. A false
  `wants_records()` affects only the JIT attempt at core-lib lines 4888-4896; it does not select
  unit capture. Static evidence therefore holds the positive-control admission. Exact callback
  count/order/payload for a false-requesting custom sink remains P3 semantic evidence and is not
  claimed here.

## A5 — HELD — one semantics body

The owned source diff is exactly three runtime files, 238 insertions/225 deletions. It defines
`UnitCapture::Output=()` and recording output `(u8,u64,Option<MemOp>)` at Hart lines 673-749, but
contains one instruction match at line 1333 and one architectural commit at lines 2311-2319.
`successful_store` is independent at line 1328 and only drives the shared overlap tail. SC still
checks alignment, consumes reservation at lines 1549-1550/1569-1570 before its fallible store,
and records success only afterward at lines 1553-1555/1573-1575. `exec_oracle` deliberately uses
`RecordingCapture` at lines 2333-2337 and is not treated as an independent oracle.

The sole WASM runtime routing delta is the approved `WasmLinux::run_chunk` call to
`inner.machine.run(step)` at Wasm-lib line 3167; surrounding cooperative scope and slicing remain
in the same body. Source structure does not establish effect equivalence; it only satisfies A5.

## A6 — HELD — explicit code-size tradeoff

| Static region | Baseline | Candidate | Delta/observation |
|---|---:|---:|---|
| Native whole probe | 868,936 | 885,768 | **+16,832** |
| Native `__text` | 490,312 | 497,424 | **+7,112** |
| Direct Hart execute | 8,888 | unit 7,828 | -1,060 |
| Machine-linked unit execute | 8,968 | unit 7,888 | -1,080 |
| Native `Machine::run` | 6,448 | 6,408 | -40 |
| Native recording execute | baseline shared 8,888 | 9,200 | retained; +312 vs that baseline body |
| Production WASM whole | 1,549,483 | 1,555,346 | **+5,863** |
| Production WASM code section | 1,335,611 | 1,341,461 | **+5,850** |
| Old Machine unit execute174 → new unit execute175 | 15,417 | 14,649 | -768 |
| Actual old Linux NullSink execute175 → new Linux unit execute175 | 13,305 | 14,649 | **+1,344** |
| WASM `Machine::run` | 9,142 | 9,136 | -6 |
| WASM `WasmLinux::run_chunk` | 2,482 | 2,474 | -8 |

Specialization adds bodies: native aggregate execute spans grow 17,856→24,916 (+7,060), and
production WASM execute bodies grow 28,722→41,036 (+12,314). Candidate recording execute174 is
13,907 bytes and execute176 is 12,480 bytes. Therefore tuple-store elimination is real, but the
actual Linux unit execute body is larger than its old NullSink specialization and both complete
artifacts grow. No shrink, speed, or budget claim survives beyond the individual static spans.

## A7 — HELD — artifact decision

Both targets have authenticated reachable unit callers, show retirement-metadata return work
eliminated on ordinary and cached dispatch, and retain compiled recording work as a positive
control. The artifact stop rule therefore clears **only** to independently retained baseline
semantic comparison. Broad gates, demo, final clone, sabotage, and any F run remain barred until
that semantic evidence holds.

`artifact-notes.md` SHA-256
`d17faf6769f6e37e622f39ac3e24571ef7b08666b90e1fbc579a4de5c2e7815e` agrees with the raw
artifacts on identities, call chains, stores, and size deltas. Its express limitation to static
code—not effect parity or speed—is necessary and correct.
