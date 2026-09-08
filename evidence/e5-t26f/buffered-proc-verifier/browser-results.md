# Buffered-proc browser predictions

Pre-registered while the fresh `52b29b9a` cold run was active and **before examining any file or state under** `evidence/e5-t26f/buffered-proc-52b29b9a/`. These predictions come only from the frozen source, wrapper contract, image metadata, and previously HELD review. They do not make F acceptance, speedup, or causality claims.

## Frozen inputs

- HEAD: `52b29b9a41103337aba77bc5d002090111991c2d`
- Helper: `324e0acddd88bd2d41b0310444e32e2262dedd3129132240134dac857d4eec2e`
- Image: `4cb3424f637ba55d709171ce21a6b7b42a67e7bdfaef7848d7f1d7c02976ec18`
- Image info: `2917a5db27613fb04e4ef7474ab844d9755b642609cf67d07469d175db4301cf`
- Chunk manifest: `6b648e57c713325d2ce3df86eeb459cf3e27c873ec2088f562ea94168b66dd08`
- Wrapper: `536d02b9833ca889c4b22b9df87f1d303d1e71df26b6fa135bdcd0d34effa90e`

The wrapper's 13 predicted source bindings are:

| Input | SHA-256 |
|---|---|
| `tools/verify/e5-t26f-browser-roundtrip.mjs` | `bfcdc06f6d6ec330815d7ad12b7a0c101035a11d50348828fe2d39a7370cb219` |
| `tools/verify/e5-t26f-resident-proof.mjs` | `28742ad80ee2b8628ae18ffc3d24b02f32a7e9c2d8706ec900bb244e1b548d6c` |
| `tools/verify/e5-t26f-discovery-observation.mjs` | `4bc9e00027a42465a37364cad1b707c87da78806a1c0d20d5729109728004d04` |
| `tools/verify/e5-t26f-compile-queue-observation.mjs` | `fff0cf5e7bbbf9c822bbe6b62cb2dcf936076da1eeb3d455d3cdd7a915c02dcc` |
| `tools/verify/e5-t26f-browser-buffered-proc.mjs` | `536d02b9833ca889c4b22b9df87f1d303d1e71df26b6fa135bdcd0d34effa90e` |
| `crates/core/src/compile_queue.rs` | `678d51e6c333e076caeb99f3960fac52a0886941cc85ebf6638062878c751b15` |
| `crates/core/src/lib.rs` | `7ff782fec3aa18b1b3729ac57e96dd999162b5c92b6fa36ef080cd9953bc2d3c` |
| `crates/wasm/src/lib.rs` | `d9b100a0b434688a34fdcd943e8f21f683c3c77e27d9fe6c240ee001399a38be` |
| `tools/guest/e5-t26f-resident-aplay.sh` | `324e0acddd88bd2d41b0310444e32e2262dedd3129132240134dac857d4eec2e` |
| `tools/verify/e5-t26f-resident-image.mjs` | `6c00973a0462847cab200a857b1946a9c54669569785dd2406d06478da5d1481` |
| `tools/chunk_image.py` | `165ccaf1c591247e23c509e6bed4fa2f614f1dee7e8a045698ad4cea447484d0` |
| `target/e5-t26f/resident-image-buffered-proc-v1/desktop-info.json` | `2917a5db27613fb04e4ef7474ab844d9755b642609cf67d07469d175db4301cf` |
| `target/e5-t26f/chunks/resident-buffered-proc-v1/manifest.json` | `6b648e57c713325d2ce3df86eeb459cf3e27c873ec2088f562ea94168b66dd08` |

## Predictions

- **B1 provenance — predict HELD.** `invocation.json`, the cold record, the reuse record, and final observation will bind HEAD `52b29b9a…`, the resident fixture, the exact helper/image/manifest above, port 61636, and order `cold` then isolated `reuse` with JIT `1` / residency `repack-off`. The cold run exits 0 and creates a new authenticated checkpoint; neither run rebinds an older seal. Every final source binding equals the pre-registered table.

- **B2 real prepared-player identity — predict HELD.** Cold preparation physically types `. /usr/libexec/wasm-vm/e5t26f-resident.sh && e5_prepare`; the input sequence is exact, preparation is accepted, both pre-save observations agree on one actual PID/start/parent/executable inode, FIFO and PCM descriptors/flags, PCM owner `PREPARED` with zero `hw_ptr`/`appl_ptr`, the green prepared marker is present, and no red marker appears. The checkpoint's helper binding is the frozen helper SHA, not merely a matching host filename.

- **B3 checkpoint sound and restore CRC — predict HELD.** The authenticated sound section describes stream state 2, parameters present, request `0x101`, stream 0, buffer 3840, period 1920, stereo format/rate codes `2/5/7`; pending transfers/bytes, release/reset/next-XRUN, TX kick, and queued playback XRUN are all zero. Normal restore uses the sealed snapshot, preserves whole-machine resume metadata, avoids a cold `booting` state, re-handshakes protocol version 1, publishes a full repair frame, and its first-present CRC equals the snapshot's eight-hex-digit `preFrontBufferCrc`.

- **B4 physical post-restore interaction — predict HELD.** Before the gesture, audio remains locked/suspended and both fresh PCM samples have zero indices, fill, non-silent frames, and amplitude. The original move/pause/down/up gesture unlocks audio; physical command text is exactly `play` at 5 ms per character, is guest-visible, and leaves no held button. The same prepared child emits the post marker without a red marker, returns success after finite feed/wait, produces positive written and non-silent PCM with positive amplitude, attaches guest output, advances rendered frames, and creates the required visible terminal diff.

- **B5 proper F predicates but original deadline failure — predict HELD.** All functional assertions through identity, display/CRC, cursor rendering, focus, physical input, terminal marker, and sound succeed. Because F is still known to exceed its original cap, predict reuse exit 1 solely with `AssertionError [ERR_ASSERTION]`, message `post-restore interaction exceeded 2 seconds`, and frozen `postRestoreEnd - postRestoreStart > 2000`. The collector therefore emits `acceptance:false`, `fVerified:false`, and `fTimingPassed:false`; it must not convert this diagnostic into F acceptance. Any earlier functional failure, missing record, signal, or different error refutes this prediction rather than being excused by the deadline.

- **B6 unchanged accounting boundary — predict HELD.** The pre/post state samples are finite, ordered around the frozen interaction boundary, share one discovery generation, show positive guest retirement/JIT progress, retain executor=true, decoded-cache 4096, repack-off/24, and valid bounded discovery/compile-queue counters. The collector's staging and backpressure conservation equations hold. These counters remain read-only post hoc observations and establish neither browser timing cause nor native-ARM performance transfer.

## Verdict rule after handoff

After Main declares the run closed, compare only the retained invocation, cold/reuse records, observation, logs, and hashes against B1-B6. Mark each `HELD`, `REFUTED`, or `NEEDS EVIDENCE` with exact JSON paths and artifact digests. Do not rerun a browser, rebuild, repeat source checks, or broaden into F acceptance.

## Closed-record results

VERDICT: **B1-B6 HELD; F timing FAILED.** The buffered observer reached the same real prepared player, restored it, physically completed `play`, and produced fresh non-silent PCM, but the frozen interaction took `11471.544999957085` ms and failed the original 2000-ms cap. This is explicitly not F acceptance, a speedup result, or a causal attribution.

- **B1 provenance — HELD.** `invocation.json` binds HEAD `52b29b9a41103337aba77bc5d002090111991c2d`, acceptance false, port 61636, retained profile `e5-t26f-buffered-proc-VprFCc`, and cold/reuse order (`invocation.json:/head,/acceptance,/common,/order`). All 13 `/sourceBindings` exactly equal the pre-registered table. Cold exits `{code:0,signal:null}` and reuse `{code:1,signal:null}` (`cold/exit.json`, `reuse/exit.json`). Cold and reuse `/milestones/run/binding` agree on runtime `ce156e701a52057dbdd8436133ac09cdecb2e6360fca90bd528981e3396b6c71`, kernel `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`, image `4cb3424f…`, manifest `6b648e57…`, helper `324e0acd…`, and HEAD 52b. The final observation authenticates raw reuse record SHA-256 `df6b98c453b6ef0794912085edf6c3c3235799531d9266158cc9fbcfb2410a56`.

- **B2 real prepared-player identity — HELD.** Cold `/milestones/residentCheckpoint/prepared` records the exact source-and-prepare command, `accepted:true`, `inputSequenceMatch:true`, `terminalMarkerSeen:true`, `redMarkerSeen:false`, 118 keyboard/DOM events, and 13,514 changed pixels. The authenticated fixture carries helper SHA `324e0acd…`, base SHA `5530d658…`, and fixed guest path. `cold/resident-prepared.png` (SHA-256 `7ba92583a3d574462f9b1aa85bf114d28eae47b3fa0dd0ea4278ec35c5f1f144`) visibly records matching pre-1/pre-2 identity `pid=999 start=27640 exe=/usr/bin/aplay(inode-match)`, `wchan=pipe_read`, FIFO/parent flags, PCM FD/owner `999`, `PREPARED`, and zero pointers, followed by the green prepared marker. The reuse failure screenshot shows post identity still `pid=999 start=27640` before the green aplay completion.

- **B3 checkpoint sound and restore CRC — HELD.** Cold `/milestones/residentCheckpoint/sound` has sound SHA-256 `42dfc147f4ad0d0b98490c3cb39bb8f3932f785a8266335fcd151de18b56858f`, state/params/request/stream/buffer/period/channels/format/rate `2/1/257/0/3840/1920/2/5/7`, and zero pending fields, XRUN events, all kicks, and reset. `/milestones/normalSnapshot` is `dd5ee19ced147f572e91df14db5eb871f84db2556c5eb00173e55fbe3ff95fbd`, CRC `e0ec6452`, persisted/paused. Reuse `/milestones/normalRestore/result` uses that exact snapshot and CRC, reports full repair, agent re-handshake, protocol 1, restored whole-machine metadata, no `booting` state, and zero sound XRUNs; `/milestones/normalRestore/displayChecksPassed` is true.

- **B4 physical post-restore interaction — HELD.** Reuse `/milestones/residentBeforeGesture[0:2]` is locked/suspended with all asserted PCM counters zero. `/milestones/postRestoreCursor` contains the actual tablet frame and matching rendered point at 810.72 ms. `/milestones/postRestoreAplay` is exact command `play`, accepted, input-sequence matched, guest-visible through 8,442 changed pixels, terminal marker true, red marker false, with 10 keyboard/DOM events. Completion PCM is 1,440 written and non-silent frames with `maxAbs=0.999969482421875`; output is attached, audio is unlocked/running, rendered frames advance from 47,798 to 559,158, and held buttons are empty (`/milestones/postRestorePcmAtCompletion`, `/postRestoreOutputAttached`, `/postRestoreAudioBefore`, `/postRestoreAudioAfter`, `/postRestoreInteraction`). `reuse/failure-post-restore-interaction-checks.png` (SHA-256 `5447fa70ec0548dc46b4f71f9050195e152ab45b8943ff90d6e6932f4df139d7`) visibly shows the same post identity and green `e5t26f-aplay`/child completion.

- **B5 functional predicates plus deadline failure — HELD.** Every preceding functional assertion reached the final cap. The retained error is exactly `AssertionError`, `ERR_ASSERTION`, `post-restore interaction exceeded 2 seconds` at runner line 1921 (`reuse/failure-post-restore-interaction-checks.json:/error`). Frozen boundaries are start `1230.9800000190735`, end `12702.524999976158`, delta `11471.544999957085` ms. `observation.json` records `acceptance:false`, `fVerified:false`, and `fTimingPassed:false`. The adjacent log (SHA-256 `850d0934251bca5fbc28544d6d971cc10e06f187808234a7d793863401308246`) retains the same cap failure and final non-acceptance observation.

- **B6 accounting boundary — HELD.** `observation.json:/before,/after` has ordered finite request/receive points around the frozen end, one discovery generation 5, executor true, decoded cache 4096, repack-off/24, timing instrumentation disabled, and positive guest/JIT progress. Staged is `12673 nominated - 106 discovery-depth = 12567`; conservation is `71 pending + 10456 backpressure + 0 cancelled + 2040 popped = 12567`. Submitted is `1508 - 94 = 1414`; popped-unsubmitted is `2040 - 1414 = 626`; `7801 incoming + 2655 displaced = 10456`. These are jobs and post-hoc counters only; they do not identify a timing cause.

## Closed artifact digests

- `invocation.json`: `226825c98c46146070e0d02af738313ae164414f655324748b899c7d547d7392`
- `cold/diagnostic-checkpoint.json`: `649d254f319787446f02321321f5e189ed358f982da6520cf963cc737a307545`
- `reuse/failure-post-restore-interaction-checks.json`: `df6b98c453b6ef0794912085edf6c3c3235799531d9266158cc9fbcfb2410a56`
- `observation.json`: `703f6589cfb196893976874449ccbe648793ed257d587f35e8207cd89b7b55f0`
- Adjacent outer log: `850d0934251bca5fbc28544d6d971cc10e06f187808234a7d793863401308246`

No browser was relaunched, and no clone, build, broad gate, implementation, task/status, queue, or source change was made during verification.

## Retained-seal integrity follow-up

**HELD.** This follow-up replaces reliance on the records' stored binding comparison with independent reads of the retained sealed tree and actual checkpoint bytes.

The retained directory is `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-buffered-proc-VprFCc`. I reproduced `browser-roundtrip.mjs:146-161` byte-for-byte in a read-only inline Node module: sorted recursive traversal, symlink/non-regular refusal, entries encoded as `[relative,size,sha256]`, and SHA-256 of `JSON.stringify(entries)`. For the served runtime I supplied the runner's exact filter from lines 170-172: include `src`, `pkg`, and `bench` trees plus top-level `js|mjs|html|css|json` files.

```sh
node --input-type=module -e 'import {readdir,lstat,readFile} from "node:fs/promises"; import {createHash} from "node:crypto"; import path from "node:path"; import {parsePreparedSound} from "./tools/verify/e5-t26f-resident-proof.mjs"; const sha=b=>createHash("sha256").update(b).digest("hex"); const fileSha=async f=>sha(await readFile(f)); async function treeDigest(directory,include=()=>true){const entries=[]; async function visit(relative){for(const name of (await readdir(path.join(directory,relative))).sort()){const next=path.join(relative,name); if(!include(next))continue; const file=path.join(directory,next); const info=await lstat(file); if(info.isSymbolicLink())throw Error(`symlink:${file}`); if(info.isDirectory())await visit(next); else {if(!info.isFile())throw Error(`nonfile:${file}`); entries.push([next,info.size,await fileSha(file)]);}}} await visit(""); if(!entries.length)throw Error("empty"); return {sha256:sha(JSON.stringify(entries)),entries:entries.length};} const retained="/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-buffered-proc-VprFCc"; const runtime=await treeDigest("web",relative=>["src","pkg","bench"].includes(relative.split(path.sep)[0])||(!relative.includes(path.sep)&&/\.(?:js|mjs|html|css|json)$/u.test(relative))); const seed=await treeDigest(path.join(retained,"checkpoint-profile")); const checkpointPath=path.join(retained,"normal-checkpoint.json"); const checkpointBytes=await readFile(checkpointPath); const checkpoint=JSON.parse(checkpointBytes); const envelope=JSON.parse(checkpoint.session.value); const bytes=Buffer.from(envelope.bytes,"base64"); const sound=parsePreparedSound(bytes,checkpoint.normalSnapshot.sha256); console.log(JSON.stringify({runtime,checkpointProfile:seed,checkpointFileSha256:sha(checkpointBytes),checkpointRecordedProfileSha256:checkpoint.profileSha256,envelope:{sha256:sha(bytes),byteLength:bytes.length,recordedSha256:envelope.sha256,recordedByteLength:envelope.byteLength,preFrontBufferCrc:envelope.preFrontBufferCrc,machineResume:envelope.machineResume},sound},null,2));'
```

Observed results:

- Actual served-runtime tree: 150 regular files, digest `ce156e701a52057dbdd8436133ac09cdecb2e6360fca90bd528981e3396b6c71`; exact match to cold/reuse `/milestones/run/binding/runtimeSha256` and `observation.json:/binding/runtimeSha256`.
- Actual sealed `checkpoint-profile`: 816 regular files, digest `b4facf9d0c1c8214e62b2a1b0dcaf39b7f9da74079ed87c07bf3b0437d09c943`; exact match to `normal-checkpoint.json:/profileSha256`, both cold/reuse `/milestones/run/profileSha256`, and `observation.json:/profileSha256`. The reuse iteration profile is intentionally live/mutable after launch and is not substituted for this sealed baseline.
- Actual `normal-checkpoint.json`: SHA-256 `72f3e635078daa0682220bb1f92d61fc14c14299091088cec0f2b100522f59df`. Decoding `session.value`, then base64-decoding its `bytes`, yields exactly 2,808,178 bytes and SHA-256 `dd5ee19ced147f572e91df14db5eb871f84db2556c5eb00173e55fbe3ff95fbd`; both equal the envelope fields and retained normal-snapshot fields. Decoded envelope metadata carries CRC `e0ec6452`, persisted/paused true, and overlay generation 641; reuse first-present independently reports the same CRC.
- Calling the frozen `parsePreparedSound` implementation (`resident-proof.mjs` SHA-256 `28742ad80ee2b8628ae18ffc3d24b02f32a7e9c2d8706ec900bb244e1b548d6c`) directly on those decoded bytes succeeds. It independently verifies envelope/section digests and returns sound SHA-256 `42dfc147f4ad0d0b98490c3cb39bb8f3932f785a8266335fcd151de18b56858f`, exact stereo prepared parameters `2/1/257/0/3840/1920/2/5/7`, and all pending/XRUN/kick/reset fields zero, matching the cold record.

Error-array and reachability limits are narrower than a successful full F run. The cold checkpoint record alone contains top-level `errors.browser:[]` and `errors.http:[]`; the failed generic reuse record has **no full browser/HTTP error arrays**. Reuse does contain `normalRestore.result.presentation.errors:[]`, which is only the presentation subsystem. The original cap throws immediately after the functional interaction checks, so later coherence completion, drag phases, moving snapshot, and second restore were not reached and are not claimed here. B1-B6 remain HELD within that boundary; F timing remains FAILED at 11.471545 seconds.
