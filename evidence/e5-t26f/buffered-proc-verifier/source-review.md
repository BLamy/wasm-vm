# Frozen buffered-proc critic

VERDICT: **HELD for the bounded buffered `/proc` acquisition/parser claim.** The source review presented no blocker to launching the fresh cold browser run. This is not an F/task, timing, performance, or actual-player verdict.

## Frozen bindings

- Candidate HEAD: `52b29b9a41103337aba77bc5d002090111991c2d`
- Parent: `7f15d76646a9f94e9c089b53bb7202fb1278a18c`
- Parent helper: `2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c`
- Candidate helper: `324e0acddd88bd2d41b0310444e32e2262dedd3129132240134dac857d4eec2e`
- Frozen candidate test blob: `1f4543e1d67757724578b1889bd39b84d489b853418ffdc0dcc248cbeca07654`
- Wrapper/test: `536d02b9833ca889c4b22b9df87f1d303d1e71df26b6fa135bdcd0d34effa90e` / `9058fdda19af29d2a460d0e23b33d8054f9fe63109357ccbaf3c84d2495d9ea7`

The final verifier run is `equivalence-run-r5/results.json`, SHA-256 `b9f445ff8476658e91793a5d4dcbe7f50b58a2e476b9b5e020fb2f159727358c`; bindings SHA-256 `ae646008ba8025b97319362149c5fa43f7f27a58b376f2b4ec594a89a5e32403`. The verifier harness SHA-256 is `8ae25d4ea4965a0460b88aac7081732ad46f31ab321a16374893f0d8f631aef8`.

## Predictions and observations

- P1 accepted output equivalence — **HELD**. Predicted source-extracted parent and candidate observers would accept identical controlled proc bytes and emit byte-identical `e5_seen` plus unchanged printer output. Full seven-field io/ordinary PCM status matched at 350 bytes, SHA-256 `8e14b203252174315a0fa98a906397fe003a71cc24fa3512d610262f1af076c8`; basic four-field io matched at 292 bytes, `c8239d90ea702f23f6057139ddf0d76a4a66d38bc71d9f936b3f54177c2e7412`; unavailable io matched at 263 bytes, `d188de9c001417c7bbb84cb91344a607e78253086151295584f3371ef8af40bf`. Corresponding legacy/candidate `stdout.log` files are byte-identical.

- P2 deliberate stricter refusals — **HELD**. Parent accepted while candidate refused: 51-field stat (`helper:69-89` exact 52-field check), newline-terminated wchan (`:115-118` exact EOF text), duplicate fdinfo key (`:93-109` unique/single-value numeric parser), surplus PCM value (`:153-171` unique/single-value parser), incomplete io schema (`:175-194` four basic plus zero/all three accounting fields), and signed `cancelled_write_bytes`. These are explicit fail-closed restrictions for pinned proc formats, with controlled records under `equivalence-run-r5/*-{legacy,candidate}`. Final PID/start/exe/parent revalidation at `helper:195-199` is exercised by the frozen tests' start/PID/parent/exe/exit mutation cases (`frozen test:330-345`). Capture failure, sentinel, bounds, FD3 closure, and no-read/eval/mock guards are exercised at `frozen test:276-325,370-386`. Bounds are post-capture finite proc-text validation, not a streaming RAM limit.

- P3 signed `cancelled_write_bytes` hypothesis — **critic hypothesis REFUTED; candidate HELD**. My provisional finding confused the kernel comment's negative *effect* with signed serialization. Pinned Linux 6.6.63 [`fs/proc/base.c:3060-3074`](https://github.com/gregkh/linux/blob/v6.6.63/fs/proc/base.c#L3060-L3074) formats all seven counters with `%llu` and explicitly casts each to `unsigned long long`; [`task_io_accounting.h:37-44`](https://github.com/gregkh/linux/blob/v6.6.63/include/linux/task_io_accounting.h#L37-L44) stores `cancelled_write_bytes` as `u64` while explaining why its effect is described as negative. The `-4096` vector is therefore impossible fixed-kernel proc text and its candidate refusal is correct. The earlier demand for signed grammar is withdrawn; no implementation change is warranted.

- P4 novel unknown-key attack and sabotage — **HELD**. An io record containing every required field plus `unexpected_counter: 7` is accepted by the loose parent and refused by candidate `helper:187`. A verifier-only mutant replacing that refusal with `:` accepts the same record; the rejection oracle then fails as intended. `results.json` records legacy/candidate/sabotaged statuses `0/1/0`.

- P5 unchanged product/runner boundary — **HELD**. Printer remains three byte-identical calls (`helper:203-210`; frozen test `270-274`). Prepare, arming, payload, FIFO feed/close, same-child wait, and markers remain unchanged at `helper:212-275`. The Make target at `Makefile:1179-1184` is fixture/harness-only and explicitly non-acceptance. The previously reviewed wrapper remains HELD: fresh output and cold seal, scrubbed environment, port 61636, 13 source/image bindings, held collector, source/head rechecks, and `fVerified:false`; its six stub tests are not browser proof.

## Other retained state and limits

The final focused Make gate is 138/138 with zero failures (`buffered-proc-gates-final.log:143-149`), SHA-256 `ce18c11c283084be5d3ac45baa776f519a242f96973876699f90cb7075c4a7b5`. The final actual native BusyBox gate is 84/84 with zero failures (`buffered-proc-busybox-final.log:85-91`), SHA-256 `bb4793d90acaeb41769578924f3cd0f24f5564cd36be10491db8f1ae0c4bdabf`.

The earlier 83/84 native failure is bounded to shared host/Colima fixture visibility, not helper capture semantics. `buffered-proc-native-fixture/check.json` (SHA-256 `2651d063f6fe5d8619641f67e333694aa636a88f668d95a04aef50a13ceeaf6d`) records reused host inode 34749046 changing from empty to nine bytes (`706970655f72656164`) at 15:14:19.613Z while the next new container's inode 16904 independently reports size/hex zero **before** `e5_capture`; the unchanged helper then accurately returns zero (`check.json:30-50`, `check.log:29-53`). A fresh unique nine-byte file uses host/container inodes 34749048/16907; container `stat`/`od` and helper all see the same nine bytes (`check.json:75-94`, `check.log:81-107`). `check.mjs:22-55` authenticates the helper and records container bytes before calling capture. Therefore fresh immutable `capture-${index}.data` files with exclusive creation are a test-only isolation correction; they add no sleep and do not change helper/runtime/image behavior. This diagnosis does not undermine real guest proc reads.

Verifier setup attempts `equivalence-run` and `equivalence-run-r2` stopped before semantic comparison because scratch path adaptation changed, then intentionally retained, the printer's executable literal. `equivalence-run-r3` completed before the signed-accounting vector was added. `r4` is retained explicitly as historical evidence of the critic's false-positive signed interpretation; it is superseded, not erased. Fresh `r5` is the final head-bound **HELD** result. No canonical source, raw attempt, FIFO tree, or prior evidence was overwritten or deleted; raw trees must be archived rather than directly staged.

The only `44e5ed3..52b29b9` test change is the reviewed immutable-input correction (6 insertions/3 deletions); frozen test SHA-256 is `1f4543e1d67757724578b1889bd39b84d489b853418ffdc0dcc248cbeca07654`, and helper/runtime/image remain unchanged. The in-progress freshly pinned cold/post-restore browser run must independently prove the actual prepared player/process/files. No browser, real-player, performance, causality, speedup, F acceptance/status, task, queue, implementation, or commit claim is made here.
