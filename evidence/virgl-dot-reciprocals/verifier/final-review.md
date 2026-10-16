VERDICT: verified

Task E6-T12e6; fresh verifier did not implement the compiler or worker harness.
Final source: `cb6726dc68eebecdaf9b848ea846e525003e86c9`.
Worker claim: `433e7f71dc8aee0dfd71bba15be14e9e25609387`.
Verified predecessor: `3adaa72f95fd88b8fefd5caa32d6407df22af1dd`.
Predictions P1–P14 were recorded in `predictions.md` before the corresponding
outputs were examined. All now hold for the task's isolated ordinary compiler
boundary. Production negotiation, guest Mesa execution and MIPS performance
remain outside this proof.

- P1/P4/P9 — HELD. The independent native build passed 4,032 initialization and
  raw-authority attacks across seven destination masks, all 24 source selector
  permutations, three scalar operations and independently removed source lanes.
  DP3 requires post-swizzle xyz; RCP/RSQ require post-swizzle x. Ignored lanes do
  not acquire authority requirements. Citation: `native-audit.json:10`, SHA-256
  `6a194c2e92589f5391b68d2124a5915c8ee011b1d99b03f8383a518aef7d4cb6`.
- P2/P3 — HELD. Independent hardware transform feedback checked 11,456 values
  from 2,864 draws, including partial aliased writes, negation, poison w,
  preserved lanes, raw/numeric agreement and positive-normal domain edges at
  2^-126 and 2^126. The verifier's Fraction/isqrt oracle does not import the
  worker oracle. Citation: `current-gpu-check.json:2` and
  `edges-gpu-check.json:2`; their complete raw capture digests are included.
- P5 — HELD. Current and independently built parent APIs reproduce every full
  predecessor result except exactly the two declared DP3 admissions. All 162
  predecessor pairs and all 19 full originals remain exact; originals retain
  12 successes and seven PRECISE rejections. The four malformed historical
  two-source RCP/RSQ errors remain unchanged. Citation:
  `native-audit.json:50750`, `:52696`, `:52700`.
- P6 — HELD. Contemporary Mesa TGSI documentation, interpreter, opcode REPL
  metadata and source-use analysis agree on the scalar contract. The older
  pinned componentwise RCP shortcut is explicitly documented. Four DP3, two
  RCP and four RSQ capture sites remain in unchanged PRECISE originals.
  Citation: `primary-source-notes.md`, `primary-source-digests.json`,
  `native-audit.json:52797`.
- P7 — HELD. Independent reconstruction matches every byte of the 1,195,201-byte
  E5 compatibility stream, including 2,083 cases, 162 pairs, 19 originals,
  unchanged 12/10 recovery anchors and four seeds. Eleven mutations of names,
  transforms, results, stream/log bytes, anchors, seeds or claimed provenance
  were rejected. Citation: `compatibility-audit.json:2` and `:27`, SHA-256
  `9fbf75760bcd6830edf2f616b2b3774cf74305936b66d68522f22accdf88ffdd`.
- P8 — HELD. Re-exporting the actual warm binary/profile reproduced the recorded
  LLVM output exactly. All 46 added executable runtime lines and both outcomes
  of all 40 intersecting branch records executed. Six nonexecutable lines are
  explicitly waived. The final cold source counters equal the HELD counters
  after changing only checkout path prefixes. Sizes remain 112-byte
  instructions, 26,232-byte IR and fixed 16 MiB Wasm memory. Citation:
  `native-recording-audit.json:38`, `:2876`, and `cold-audit.json:58`.
- P9 sabotage — HELD. Independent xy-only DP3 corruption fails 1,644 numerical
  checks; independent multiplication/sqrt reciprocal corruption fails 3,292.
  Both failures are actual hardware captures. The final worker's four
  independently reconstructed source corruptions also fail at actual output
  mismatches. Citation: `sabotage-dot-gpu-check.json:198`,
  `sabotage-reciprocal-gpu-check.json:198`, `cold-audit.json:92`.
- P11/P12 — HELD. All 22 authored reciprocal/sample enclosures were independently
  recomputed using rational division and 224-bit isqrt brackets. Division uses
  the specified 2.5-ULP allowance; inverse root uses two ULPs. Exact roots are
  still bounded, and exceptional observations claim no unsupported payload,
  computed-zero sign, subnormal preservation or cross-stage equality. Citation:
  `frozen-math-audit.json:5`, SHA-256
  `e913b57d9b452f4f06155eb48f8ac173a310267e0aa391a616d1c78f22ef9c7c`.
- P13 — HELD. Eight detached evidence mutations were rejected, including a
  coherent out-of-range raw result and an individually in-range result violating
  scalar broadcast. Final captures have 310 exact words, 178 bounded words,
  72 exceptional observations, 72 joint-consumer draws, 6,144 sampled pixels,
  33,728 interface pixels and zero leaked GL objects. Citation:
  `worker-browser-audit.json:69`, `cold-audit.json:60`.
- P10/P14 — HELD. The final clone starts and ends clean at cb6726dc. All 205
  copied files equal the retained clone artifacts; all 268 source blobs equal
  committed source and both checkouts; all 195 receipt leaves match. The native
  stream and complete transcript equal the earlier HELD run. The complete
  predecessor receipts and final hardware/fault records were revalidated
  read-only, without rerunning or rewriting acceptance. Citation:
  `cold-audit.json:2`, `:10`, `:150`, SHA-256
  `6316ad5105ffc1349328404dc5ec844262390ea1a47b9ae2551e22de5a7ace14`.

The only coverage finding was an unused browser helper (`fraction` at old line
95). It was removed in cb6726dc; no runtime or other source changed. The affected
five browser recordings were renewed honestly at the new head, followed by one
complete final cold run. All 151 remaining browser functions entered in both
new-head sets. `harness-coverage-waivers.json` accounts for residual defensive,
diagnostic and out-of-domain oracle ranges. `coverage-matrix.md` accounts for
all changed source groups. No unresolved refutation or proof gap remains.

Final cold receipt SHA-256:
`42532735ad1bb140a4b0a5df551d4b9b6c0f4f0f67484d25446f7273c2d108f5`.
Final cold report SHA-256:
`dcf7972d3ffabd2c448017d3c1304da081a9af980665ae9c13411daf960e099b`.
The final hardware screenshot was visually inspected, SHA-256
`89a31f3f97bf316fbdf661cf0789b73c438c4f4dec78fb18d7fe7d23c5511161`.
Its scope caption explicitly states that guest graphics negotiation remains off.

SUITE: retain the shared scalar admission/pair fixtures, the rational GPU
workload and four sabotage controls, explicit E5 compatibility checks, and
`make verify-E6-T12e6`. Retain the verifier's independent native/GPU attacks,
receipt mutations and raw captures as reproducible audit evidence. No additional
runtime test is necessary: the permanent gate already covers the accepted
boundary, while the independent scripts preserve different derivations.

All temporary native/sabotage libraries and source checkouts remain outside
the committed verifier evidence. Earlier interim reports preserve their actual
historical status; this report closes their pending final-evidence items.
