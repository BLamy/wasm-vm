# E5-T26f post-P browser screen — independent results

**VERDICT: FAILED — the preregistered F two-second criterion is refuted.**

This is the bounded diagnostic-screen verdict, not an E5-T26f task verdict. I inspected the
closed JSON, logs, checkpoint metadata, and PNGs without rerunning the browser or changing code,
task metadata, or status. The preregistration is `plan.md`, SHA-256
`2ee1649d0d6d9f0ec73d99df8920fbf9e144ce6af860b3dcd2c2445526cfae94`.

## Prediction adjudication

1. **Prerequisite and launch order — HELD.** P's independent verdict is `verified` at
   `078500ebbef1c5d90adf973790ad68b7579a5879`; its immutable verdict SHA-256 is
   `154e61bd84cfd98011d5214fefba0157818720045aaa2b4e068796068665bc45`.
   Both that source commit and verified-metadata commit
   `46629788b3c1074c02a6395f7b636057721fe426` are ancestors of frozen F head
   `415db223733214b6c6e7b69b0ad331150969be56`. P correctness is carried from that verdict,
   not re-reviewed here.

2. **Exact immutable bindings — HELD.** Invocation, owner, cold, reuse, and collector all bind
   head `415db223…`, runtime-tree SHA-256
   `21dce9b435890a40278d8935800accbccc0d0c3d59676fe3ce6b47d136471926`, kernel
   `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`, image
   `d2fc4eab…`, manifest `e02a9af5…`, fixture `resident-observer-v1`, and origin
   `http://127.0.0.1:61637` (`invocation.json:2-15`, raw record `:56-81`). I independently
   rehashed all 17 invocation source bindings successfully. The 150-entry served-runtime tree
   independently reproduces `21dce9b4…`; production
   `web/dist/pkg/wasm_vm_wasm_bg.wasm` independently hashes to the preregistered
   `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`.
   The closed checkpoint identifies headless Chromium `Chrome/152.0.7977.76`.

3. **Carried image/helper proofs — HELD.** Independent rehash gives the unchanged 1-GiB image
   `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72` and helper
   `5807b908fc1bd84ff19c96e269df6b69ac86d3a62412a032f476dc8ea7f581d9`.
   Image metadata and invocation source pins agree; observer source, binary, build-info, and
   readback digests also agree (`observation.json:12-32`). Their unchanged independent proofs
   carry without re-litigation.

4. **Fresh cold seal — HELD.** The wrapper used a new retained directory, cold exited 0 without
   a signal, and the closed baseline profile independently reproduces its 816-entry tree digest
   `e6df3a0abc0f65583a74d6cc7e43a4226022e7297fc0f4c2067d099bc168f8dc`.
   Decoding the checkpoint's actual envelope independently gives 2,810,500 bytes and SHA-256
   `e53e5a3936ef2d35e6ae5e09676dba51cfc59d63ed37dbc56c94998810e6ac9f`, matching cold,
   reuse, and collector. The snapshot is paused/coherent at generation 628 with CRC `fe94d179`
   and a `resume` decision (`cold/diagnostic-checkpoint.json:224-283`). The inspected cold PNG
   visibly contains two windows, terminal text, custom cursor, initial-playback marker, and the
   prepared resident player; its SHA-256 is
   `ec4777379032f308fe09e8954858561b81facc34734c696e95149c7360a9d225`.

5. **Prepared-player identity — HELD.** The cold PNG shows both `pre-1` and `pre-2` as actual
   PID 1000/starttime 30070, `/usr/bin/aplay` inode match, `wchan=pipe_read`, FIFO FD 3
   read-only with parent FD 3 and zero child writers, plus PCM FD 4 owned by PID 1000 in
   `PREPARED` with `hw_ptr=0` and `appl_ptr=0`. The inspected failure PNG shows the post-restore
   observation with those same values before the green `e5t26f-aplay` marker. The decoded saved
   sound state is prepared (`state:2`) with parameters present and zero pending transfers,
   pending bytes, release, XRUN, events, kicks, or reset (`cold/diagnostic-checkpoint.json:193-217`).
   The failure PNG SHA-256 is
   `ea9d049665db5224245f49861f2e1bb1139aef0780b2a732b2e810261265d4d1`;
   `post-restore.png` is byte-identical.

6. **Unchanged default, unprofiled policy — HELD.** Reuse records physical command `play`,
   5-ms key pacing, JIT `1`, URL quantum 500000/default decoded capacity 4096, residency
   `repack-off` with cap 24, and no command, latency, CPU, guest-clock, COMPLETE, divider, or
   guest-profile override (raw record `:17-36`, `observation.json:77-126`). Entry timing is
   disabled with zero timer reads. No performance improvement is inferred from P or this arm.

7. **Reached functional observations — HELD.** Saved CRC and first-present CRC are both
   `fe94d179`; restore reports full repair, fresh HELLO generation 2, and boot states only
   `fetching`, `instantiating`, and `restored`, with no `booting` state (raw record
   `:168-239`). Two pre-gesture observations are locked/suspended with zero written, inspected,
   and non-silent PCM (`:373-411`). The cursor is rendered at 684/392 with 94 matched pixels;
   focus is guest-visible; all 10 keyboard and 10 DOM transitions match; the marker is fresh;
   and held buttons are empty (`:413-465`, `:505-515`). After the same prepared child completes,
   audio is unlocked/running and attached, with 1,440 written, 1,440 inspected, and 1,440
   non-silent fresh frames, maximum absolute sample `0.999969482421875` (`:466-504`). This is
   no claim about bit-exact duration or unsampled first arrival.

8. **Mandatory F two-second result — FAILED.** Normal restore `completedAt` is
   `1146.9800000190735` and frozen `postRestoreEnd` is `4738.945000052452` (raw record
   `:173`, `:505`). Independent subtraction is exactly
   `3591.9650000333786 ms`, which exceeds 2000 ms by `1591.9650000333786 ms`.
   Reuse exited 1 without a signal on the explicit assertion
   `post-restore interaction exceeded 2 seconds` at the frozen runner's line 1930 (raw
   `:599-604`). The collector agrees with `fTimingPassed:false` and that exact interval
   (`observation.json:5-7`). Outer success cannot convert this into F acceptance.

9. **Diagnostic remains non-acceptance — HELD.** `invocation.json` records
   `acceptance:false`; cold and reuse records do likewise; `observation.json` records both
   `acceptance:false` and `fVerified:false` (`invocation.json:2-3`; `observation.json:3-7`).
   The observed cold-0/reuse-1/outer-0 disposition is valid failure retention only. Normal full
   `make verify-E5-T26f` and a fresh independent review remain mandatory.

10. **Reached coverage and bounded disposition — HELD with deferred F phases.** Normal restore's
    coherence audit is explicitly `deferred` (`raw record:237-239`). Drag-phase saves, second
    reload/restore, and no-stuck guest hover were not reached and remain **NEEDS EVIDENCE** in the
    eventual full F run. Cold has complete empty browser/HTTP arrays, but the failed reuse record
    has only presentation-local `errors:[]`; complete reuse browser/HTTP arrays therefore also
    remain **NEEDS EVIDENCE**. The server transcript contains only the permitted favicon 404s.
    No old failure, profiler hypothesis, aggregate counter, speedup, or cause is inferred.

## Immutable artifact anchors

- Invocation: SHA-256 `27a95fede03b5bdcc1cae6b30cff720f1fe0c2f4539e58cb229dd95657889c51`.
- Cold record: SHA-256 `c8a6ad398e8d15ef0fc847834dc19af04f936d26a7c066275845903f81b1324a`.
- Failed reuse raw record: SHA-256
  `1d64b878e1bb426d22dfb94eb75e45dd727dfeb061d36674ae3a7e15c304c90d`.
- Collector observation: SHA-256
  `c823936ddb5e3a4575c2ecc38e9edb8af8dc32c69bb98df43791aa78733243ea`.
- Cold/reuse exits: 0/1, both `signal:null`; wrapper/outer exit was 0.

No suite promotion follows from a diagnostic timing failure. The separate CPU capture may be
reviewed only as a bound, partial sampled diagnostic and cannot alter this verdict.
