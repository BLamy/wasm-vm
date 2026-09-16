VERDICT: verified

# E5.5-T03aq — fixed guest evdev capacity

Fresh critic of worker submission `fe446fb5c4c52ece022465a3f8e6c301bcc30186`.
Implementation head: `97743da727ee51eb7326b112c18653ff02941da1`.
Predictions were written before worker results in `predictions.md` (SHA256
`c5daed63a32ca6439b6fe21b807857440ec3c6227a1f38dddd39d65793967895`).
The verdict covers delayed Linux evdev burst retention. Desktop responsiveness
still requires AR's new-kernel pair and AS's uninstrumented physical/visible proof.

## Predictions and observations

- **P1 kernel boundary — HELD.** Independently extracted pinned Linux 6.6.63
  `evdev.c` SHA256 `b5d436fbe355b563f5dc40854bc3cc65e11c8fef348b0200463d736a726ffe56`
  matches the worker's original source. The complete source difference is line12:
  `EVDEV_MIN_BUFFER_SIZE 64U` becomes `1024U`; the exact unified patch matches.
  Candidate Image SHA256 is
  `3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d`;
  baseline remains `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
  The 113911-byte config is identical (SHA256 `18da28e0c47eebda7950564df60df7a13b56b1ffa37ee6b0463924b81f95595d`).
  The pinned container/tarball, no-network command and successful removal of the
  unique build volume are recorded in `build-audit.json`. No requirement remains.
- **P2 real shared reader — HELD.** Independent CPIO/ELF inspection binds the
  same actual static RV64 init SHA256
  `dc02be6636bc3e8175d613cb8f5cdfccd9004d13704b9c2c58097b64541c424a` to initrd
  `8697951ed69a16357d09e301e02ba6c9bafa7daf2a9f99fae3fc89514a06c63e`.
  All five commands cold-boot that initrd, with no RAM restore. All streams identify
  event0 as `wasm-vm virtio keyboard`, measured fd3 and independently opened fd4,
  major13/minor64/inode621. Source audit establishes the only measured-client
  ioctl is EVIOCGNAME before injection; only fd4 uses EVIOCGKEY. Pinned
  `linux-6.6.63-evdev.c:886–921` shows the queue flush is per issuing client.
  Source and actual sentinel/readback order agree. The anticipated standalone
  capability dump was not emitted; capabilities are outside this change and
  carry through unchanged driver/config bytes, rather than a new capability claim.
- **P3 258-event candidate burst — HELD.** Independently decoded
  `../evdev-buffer-r3/guest/candidate-burst.stdout.log:175–432` contains exactly
  64 A make/sync/break/sync repetitions then B-down/sync, without SYN_DROPPED.
  Raw6192-byte stream SHA256 is
  `d215334ed69d1abebd40cefc882d55806006ee6499b788c031ea3a6f4f37ebf7`.
  The next marker reports EAGAIN; host pending reaches zero, guest exits0 and its
  retirement-record evidence records 328921139 instructions/state SHA256
  `70368a781f6a7e834dc5c76ba728607dbba81dd05ddf944cdbe2ed54ff6f09ee`.
- **P4 baseline loss tail — HELD.**
  `../evdev-buffer-r3/guest/baseline-burst.stdout.log:175–184` matches the
  pre-result literal prediction: DROP,sync,A-up,sync,A-down,sync,A-up,sync,
  B-down,sync. Raw240-byte stream SHA256 is
  `b7e662b972470375a13b9b492a6e42eb2cb4b292b6fa19b13b4ba7631f834c83`.
  This is an actual Linux read, not a simulated ring. The only kernel source
  difference explains the retention boundary in this controlled experiment;
  it does not retroactively give AP's marker a uniquely proven cause.
- **P5 overflow stays bounded — HELD.**
  `../evdev-buffer-r3/guest/candidate-overflow.stdout.log:175–178` contains
  exactly DROP,sync,B-down,sync after1026 injected events. Raw96-byte SHA256 is
  `672500ab77efb2ad12c176d8807593357858344756a982cd7586f0fa06f7a0b7`.
  Pinned allocation remains a fixed1024-entry ring and the overflow algorithm
  is unchanged. The opposite boundary attack below confirms near-full retention.
- **P6 legacy and opt-in — HELD.** Both legacy streams' lines174–177 contain
  exactly four A make/sync/break/sync events with no sentinel. New argument parsing
  is bounded1..512 and requires `--keyboard-proof`. Worker `acceptance.log:8–16`
  records the affected CLI tests and successful configured build. Independent
  executable probes of0,513 and missing opt-in all reject with exit2 before boot
  (`boundary-255-r2/{zero,over-limit,missing-opt-in}.stderr.log`).
- **P7 provenance — HELD.** `audit-worker.py` rehashes all36 files under worker
  seal SHA256 `2beac5de05aefc0d6e5d4ea4b62a332264b41dcb4d03acf2c3cc14a09064f541`,
  checks every input/output identity, and independently decodes every raw event.
  `worker-audit.json` records line citations, stream/evidence hashes and all five
  normal guest exits. AO WASM stays
  `36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916`;
  no core/WASM/web implementation hunk changed. No portability/deployment claim
  was made, so the medium-risk policy does not require a cold clone here.

## Independent novel attack

**HELD:** 255 A pairs plus B-down/sync produced all1022 events below capacity,
no SYN_DROPPED, and then EAGAIN. See `boundary-255-r2/stdout.log:15–1036`, done
at1037, raw24528-byte SHA256
`06cf3f87e6ddf4b2b746db24e96bb4c4a647a033e2481fd9f2babe09132a4fa2`.
The run used the frozen CLI/kernel/initrd in a scrubbed environment and completed
normally in22.408s. Its retirement-record digest is FNV64 `fc3b0cda7f58a0e6`,
500894093 instructions, final state SHA256
`1f4cf299419a2767ffd7e3755819fbc516161625de946a69990912a70b2c0f1c`.
Before/after file identities match in `boundary-255-r2/result.json`.

The first attack's strict line parser failed because the kernel's
`random: crng init done` printk split event617's hex at raw stdout lines793–794.
All1022 records and the final count were present. The original failed result,
command, parser, raw output and exact one-message reconstruction remain under
`boundary-255-r1/`; `offline-recovery.json` and `recovered-events.bin` prove all
literal events after removing only that identified printk. The confirming run
changed only the test command line to `loglevel=3`, preserving kernel/source,
input count and measured reader, and returned an unambiguous complete stream.
This recording-format issue did not refute the kernel claim.

## Diff coverage and disposition

| Changed hunk | Evidence / disposition |
|---|---|
| Kernel capacity constant | Actual baseline/candidate delayed opens and reads;258 retention,1026 overflow and1022 near-capacity attack exercise the allocation and boundary. |
| CLI argument, constructor and optional burst injection | Legacy plus64/255/256-pair guest runs; parser rejects absent opt-in and both invalid bounds. Production browser/core input policy is unchanged. |
| Guest init identity, independent state client, delayed read, dump and normal shutdown | Same hashed init in all five worker boots and novel run; both legacy/burst branches, sentinel, literal records, EAGAIN, close and poweroff observed. |
| Guest init defensive error/timeout branches | Waived: test-fixture failure reporting and finite bounds; no claim of product behavior relies on triggering invalid environment/partial records. |
| Python isolated build, exact source patch and artifact checks | Successful pinned no-network build, exact full config/source comparisons and cleanup0 in recorded build; early failed preflights preserved. Identity guards and exceptional failure-reporting branches are declarative validation, waived. |
| Python deterministic initrd and five-case recorder | All entries independently unpacked; all five actual commands/results and raw streams independently verified. Parser/identity rejection branches are harness validation, waived. |
| CLI config tests and Make target | Recorded format, configured clippy,3 tests and release build; no ignored tests or runtime bypass introduced. |

**SUITE:** Keep `make verify-E5_5-T03aq`, the real guest reader, literal stream
checks and opt-in CLI argument test. Promote the independent near-capacity command,
its raw stream/digest and audit scripts as evidence in this directory. These tests
prove the narrow fixed-capacity kernel claim; no screenshot or desktop-response
claim is substituted. There are no outstanding falsification or coverage findings.
