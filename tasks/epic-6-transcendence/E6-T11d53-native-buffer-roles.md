---
id: E6-T11d53
epic: 6
title: Carry qualified uniform and shared-role buffers through native desktop submission
priority: 525.027039000398
status: verified
depends_on: [E6-T11d52, E6-T11d18]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend only the selected desktop native buffer metadata envelope to match the
independently qualified host store's original creation hints:0,16,32,48,64,80,
96 and112. Target0/format64 remains byte-addressed, height/depth/layers1,
level/sample/flags0, with the existing per-resource and aggregate budgets.
Ordinary constructors retain their historical profiles. Native accepted owner
snapshots, DMA and later queue completion must compose with existing selected
host uniform/index/vertex ownership. No new shader, image, scanout or positive
production capability is granted.

## Deterministic acceptance

`make verify-E6-T11d53` sends all eight original hint combinations through real
selected Wasm virtqueues and actual hardware WebGL2 storage. Transfer original
guest backing words, bind a nonzero uniform bank in both stages, execute a
standard GPU draw and independently check every pixel of a complete output plane.
Record three schedules, actual native calls, full guest input/output, request,
response, ring and response guards. Check native/host identity, generation,
membership and byte accounting before and after admission, transfer, completion,
reset and disposal. Vary source words after backing attachment to prove live DMA.

Reject unsupported masks, dimensions, flags and budgets before publication;
check complete native/host state and GPU allocations remain unchanged.
Preserve selected64/65 and ordinary16/17 ownership boundaries. Authenticate
unchanged D18/D49/D50/D51/D52 facts by matching source/evidence identities;
no new host semantic claim rests on a fixture or null sink.

Record native guest-loop traces and digests and changed Rust/Wasm/JS execution.
Run the scoped fmt/clippy/native/wasm/browser submission and one final scrubbed
pristine clone. The built/default/live demo retains127/0, absent proof exports
and the existing graphics partial pip; rebuild/commit/deploy per AGENTS.

## Adversarial verification

Attack every original hint and unsupported neighboring masks, budget rollback,
accepted identities, SG/backing epoch/generation, dirty source ownership and
reset/cancellation. Run independent schedules and one bounded integration attack.
Sabotage native selected buffer admission so a uniform/shared-role request is
refused; require the independent exact response or pixel oracle to fail.
Classify changed-hunk coverage and authenticate complete bodies and final clone.
Carry unchanged held results incrementally. A fresh verifier alone sets verified.

## Verification log

### 2026-10-12 — worker — native buffer admission negative readiness

D52 is independently verified at `59bf446955cc2b78b84d94fcd03cb3f3f4f1c230`
and published as open/draft PR530 on the existing stack500. The continuity audit
preserves both stack identities and every130 prior PR identity, order, head and
base; all131 PRs remain open/draft/unmerged.

At that clean verified head, the real Wasm/native queue refuses uniform bind64
and combined bind112 target0/format64 requests with0x1205 before any host
callback or GPU allocation. Full native/host owner snapshots remain unchanged.
The same original metadata succeeds through the selected qualified hardware
host store. Each buffer owns64 GPU bytes and disposal releases all objects.
The bounded readiness matrix also reproduces native refusals for RGBA8 mip
chains, RG8, RGB8, floating RGBA and Z16 while the qualified host admits them.
This S task closes only the byte-addressed buffer-hint boundary.

Exact repro:
`node /tmp/wasmvm-selected-native-storage-readiness.mjs --output /tmp/wasmvm-selected-native-storage-readiness-verified`.
The complete runner is retained as archive member `readiness-runner.mjs`.
The run records359 actual GL calls on M4 Max Metal, zero browser errors,
complete request/reply/ring/guard/owner/source bodies and no Linux guest,
DMA, shader draw or production capability claim. Its68 complete bodies are
sealed in `evidence/virgl-production-readiness/native-buffer-role-gap/`:

- manifest `00f3d741c0bee960f4c2839e922325963c80f21d802b7a480288657a6158e8e9`
- index `ac7d984aeb87341e1b169a14410b733593c3a64486e1f2d9bf5f17a7b0ca3051`
- archive `2d7f61b9b143692dc46a1369d104446cfa6cf2ded86933c2fda2e52e43369b51`
- report `6b70b791ae1cf68be436449652979e12a19e267bf7f3c6ef5b9ad104162f2619`

The explicit human instruction continues production guest graphics ahead of
unrelated general-queue work. Typed capabilities, complete API/storage/image
transport, actual Mesa/Hyprland, worker/scanout and throughput remain parent work.

### 2026-10-12 — worker — recorded selected buffer submission

Runtime and literal fixtures froze at `a8974b3f750a1cc85efdcde89176be0d73592a24`.
The only subsequent changes at final head
`35a1f0c2987782ded50dc7240c33671d9265ce1a` tighten inline-guard coverage
reporting and its sealing receipt; runtime, fixtures, native responses and
canonical state records remain byte-identical. The complete final pristine
submission at that exact head is authoritative.

Commands:

```sh
VIRGL_NATIVE_BUFFER_EVIDENCE_DIR=target/evidence/virgl-native-buffer-final make verify-E6-T11d53
python3 tools/virgl-native-buffer/coverage.py target/evidence/virgl-native-buffer-final/coverage-recheck
python3 tools/virgl-native-buffer/cold.py target/evidence/virgl-native-buffer-cold-final
python3 tools/virgl-native-buffer/seal.py target/evidence/virgl-native-buffer-final target/evidence/virgl-native-buffer-cold-final evidence/virgl-native-buffer/worker
bash tools/deploy-cloudflare.sh
node target/evidence/virgl-native-buffer-deployment/final/source.mjs --output target/evidence/virgl-native-buffer-deployment/final --task E6-T11d53
```

The warm gate passed25 commands. The final cold clone passed26 (including fresh
npm dependencies), scrubbed inherited compiler settings and remained clean
before/after at `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-native-buffer-cold-dx5y2ed3/repo`.
Its receipt is `50893a0c943bb5ee3fd3af027619b9626bec72709b7b7f10e24f139f8d992221`.
The archive retains every command, stdout/stderr, source body, actual GL call,
Wasm input/output, queue record, instrumented native binary/profile/export,
fault source and literal failure point, and complete cold receipt.

Across three schedules and all eight original hints, real selected Wasm
virtqueues admit the original byte-addressed buffer. One original guest
allocation supplies vertex, private indexed-draw source and nonzero bank1
uniform data in both shader stages. Fresh guest SG words written after
attachment reach hardware WebGL2; an independent word model checks all6144
pixels from24 draws. No saved reference output initializes DMA. Full canonical
identities, backing generations, budgets, response/ring/SG guards, later
completion, cancellation, reset/profile retention and disposal are recorded.
Unsupported neighboring masks/dimensions/flags and4MiB/32MiB budget failures
preserve complete native/host state before callback/allocation. Historical
profiles and selected64/65 versus ordinary16/17 snapshots survive.

The native recording has302 canonical queue records,294 selected response-guard
and machine-digest points, and827 retired queue-loop instruction traces; it
claims no Linux desktop execution. The compiler's finest segments cover both
changed executable Rust lines and all15 dynamic operands, with eight explicit
syntax waivers and no gaps. The profile/height/mask predicates execute139/122/114
times and the admission body91 times. The original warm reporter waived an
inline guard too broadly; the separately retained supplemental check and final
cold gate correct that reporting gap without a runtime edit.

The independent sabotage checkout changes only selected mask112 to48. At hint64,
the actual native queue returns0x1205 with unchanged guards; the literal0x1100
response oracle fails. Its full request/response/state point is
`cold/recording/fault-native-buffer/report.json` in the archive. The final GPU
recording includes183362 actual native calls on M4 Max Metal and zero errors.
The submission authenticates74373 complete prior D18/D49/D50/D51/D52 bodies,
with matching unchanged source and dependency identities.

`evidence/virgl-native-buffer/worker/` seals1546 complete bodies,31468235 compressed
bytes, all reopened and checked:

- manifest `4d21b3f3fbbf1bf04bfb4031018f8ef3f935c4d96fa74d7c6b1015dfbc851722`
- index `1f53391aca79e771c27bcda31705bccb7ff21e6b39fd0552dd33e3dc4a93cdeb`
- archive `c28313356f2f469e37e8791dd286ab131d16740a83fd166f3e22caa90b96d214`

The pre-commit hook rebuilt and committed `web/dist` with the runtime change.
Cloudflare deployment `https://db2278b9.wasm-vm.pages.dev` is live at
`https://wasm-vm.pages.dev`. The built and live page pass127/0, expose no proof
exports, retain the partial graphics pip and explicitly disabled production
acceleration, and serve unchanged default Wasm digest
`62a698e3570534437f5d668885b8df2b6a03d6d01e6081814ae1654b22e3230a`.
Only the permitted favicon404 occurs on live. Complete deploy/live sources,
logs, rewritten manifests, reports and screenshot are in
`evidence/virgl-native-buffer/deployment/`. This closes only native selected
buffer admission; image metadata/level-aware DMA, typed capabilities,
worker/scanout, actual Mesa/Hyprland and throughput remain parent work.

### 2026-10-12 — fresh adversarial verifier

VERDICT: verified

Oriented against the complete task and diff from verified D52
`59bf446955cc2b78b84d94fcd03cb3f3f4f1c230` before opening evidence.
Fourteen concrete predictions were recorded in `predictions.json` before
inspection. Submission head was `ad48fc1aa47bb88759229971745891002ac8304c`;
the authoritative unchanged product recording remains exact frozen head
`35a1f0c2987782ded50dc7240c33671d9265ce1a`. The critic did not edit runtime.

- P1 authentication — HELD. Streaming reads authenticated all1546 worker
  bodies and all74373 bodies in the ten carried D18/D49/D50/D51/D52 seals;
  604 cold source pins and432 held source pins match. The worker manifest/index/
  archive identities match this claim and the prior seal identities equal the
  verified D52 base. Citation: critic `authentication.json:1`.
- P2 admission / P3 rollback / P4 budgets and ordinary profiles — HELD.
  Native replies are literal0x1100 for hints0,16,32,48,64,80,96,112 at worker
  `cold/recording/native-submit.stderr:64,117,173,229,285,341,397,453`.
  Original metadata, generations and equal logical/GPU width accounting hold.
  All95 native invalid points preserve complete canonical state; first refusal
  is line79. Hardware independently records67 refusals with unchanged native/
  host ownership and no allocation. The two budget refusals at lines29/32
  return0x1201 at32MiB, canonical digest
  `9ecdc1dc276d5a31cd10fed7dd6e33ec967776802af2ade8b06e8b870fdfd1af`.
  Exact ordinary16/32/staging524288 succeed; other original hints refuse.
  Staging at line59 adds zero GPU bytes. Full per-point digests and decoded
  state are in critic `independent-worker-audit.json`.
- P5 identity and live DMA / P6 pixels / P7 hardware / P8 reset — HELD.
  For all24 runs, original bank201 retains native/host generation, backing,
  metadata, membership and accounting. Attachment contains onlyA3; subsequent
  full DMA input equals the dirty original bank. The same allocation supplies
  vertex, private index and bank1 uniform input in both stages. Independent
  uint32 arithmetic on original vector1023 words predicts every6144 worker
  pixel and every6144 fresh-schedule pixel. Metal records24 actual draws per
  corpus, compiled shaders, uniform ranges, index copies, fenced collection,
  no `finish`, and zero browser errors. Every new-hint run cancels its pending
  job, advances epoch and re-admits that hint after reset. Concrete hint112
  points: worker `cold/recording/hardware/report.json:2974359` (accepted
  owner) and `:2983468` (complete output), body digest
  `cd2f60f90bf02f895295737f7e53901079ac4f7a8736d5c751dfccb1b2d2a672`.
  Critic audit retains original words, offsets, computed outputs and each
  canonical digest. Fresh schedules were37173,48898,30285.
- P9 accepted-owner boundaries — HELD. Selected64/65 and ordinary16/17 remain
  exact; metadata/generation/foreign/backing/count envelope attacks refuse
  without host mutation. Existing store, shader and submission semantics are
  carried through unchanged source and complete evidence identities, not
  re-qualified as a new compiler/image/storage claim.
- P10 changed-hunk coverage — HELD. Re-exporting the archived binary/profile
  exactly reproduces the frozen LLVM coverage. Finest guard segments execute
  profile139, height122, mask114 and admission91 times. Both executable lines
  and all15 dynamic operands are hit; eight structural syntax waivers and all45
  changed hunks are classified in critic `coverage-classification.json`.
  There are no product coverage gaps. Counter point: worker
  `cold/recording/changed-coverage.json:13`; raw export/profile/binary retained.
  Browser CDP also records actual runtime and callback-marshaller execution.
- P11 pristine/environment proof — HELD. All26 frozen command receipts and
  stdout/stderr hashes authenticate, including fresh npm; the existing final
  clone is still clean at the exact recorded head and all604 clone source pins
  match. Scrubbing is explicit in the recorded runner. Receipt
  `50893a0c943bb5ee3fd3af027619b9626bec72709b7b7f10e24f139f8d992221`;
  citations: critic `cold-coverage-audit.json` and worker `cold/report.json`.
- P12 sabotage — HELD. A fresh isolated mutant independently reproduces
  hint64→0x1205 when mask112 is replaced by48. The literal0x1100 response
  oracle fails exit101. Critic `fault-critic/stderr:226,233,234` and its
  complete request/response/canonical/guard point in `fault-critic/report.json`
  show that the acceptance suite detects the original admission gap.
- P13 built/live demo — HELD. All nine deployment bodies authenticate against
  manifest `7c5bdc81eb1865273065d34b9ae0797a1fc17676ee587f87b67dba450111a47e`.
  Built/live127/0, absent proof exports, partial graphics and disabled
  production hold; only live favicon404 occurs. Deployment
  `final/report.json:1002,1006,1007`, digest
  `373ebfb1b9b363ed53e5ad83e32a249ec0af0930da92e3de22df98a48fdf8988`,
  retains the unchanged default Wasm62a698e3 digest named above.
- P14 bounded novel attack — HELD. Promoted
  `selected_desktop_buffer_reset_reuse_rejects_high_bits_and_stale_dma` proves
  high-bit mask refusals consume no generation, then cancels a pending hint112
  transfer and reuses its public ID with new epoch/resource/backing identities.
  Stale epoch, resource and backing tokens reject gather/scatter without any
  SG, ring, response or canonical-state mutation; late completion also rejects.
  Fresh split-SG DMA and completion succeed. Critic
  `promoted-native.stderr:525` records empty reset state, digest
  `32d72c9b54455cf51da03fb929e606f66a05c6f2ef36c97d949ee5322d62d83a`;
  `:534,537` record fresh DMA/completion, digest
  `947e70aaadd3b0455477c008b189eefc40136f0476230fe7fa87faea66946d08`.
- SUITE: promote the bounded native regression above. Touched-harness fmt,
  clippy and all three `selected_desktop_buffer_` tests pass; full command,
  stdout/stderr, test source and native binary are retained. This promotion
  changes tests only, so the authenticated product/cold gates carry forward.

Commands: `node tools/virgl-desktop-submit/browser.mjs --suite native-buffer
--seeds 37173,48898,30285 --output target/evidence/virgl-native-buffer-critic-final/hardware-independent`;
`python3 tools/virgl-native-buffer/fault.py target/evidence/virgl-native-buffer-critic-final/fault-critic`;
`cargo fmt --check -p wasm-vm-core`;
`cargo clippy --offline -p wasm-vm-core --features virgl-control-proof,gpu-trace,trace --test virtio_gpu_submit3d -- -D warnings`;
`cargo test --offline -p wasm-vm-core --features virgl-control-proof,gpu-trace,trace --test virtio_gpu_submit3d selected_desktop_buffer_ -- --nocapture --test-threads=1`.
Independent decoders/authentication/coverage exports and full commands are
inside the critic seal. All14 prediction outcomes and precise body/line/digest
citations are in `verdict-points.jsonl`.

`evidence/virgl-native-buffer/verifier/` seals146 complete bodies,
18684855 compressed bytes, all reopened and authenticated:

- manifest `b491774df16cda3e20fc1d044b6dfe2d517023ad1da61b0b58db4c9bbef0dfe5`
- index `506caf42ba7be99f4a4aa2c98472860b17e7626cc23639e19deb293a71900c3c`
- archive `7e69541eaa14d27feda388731f7fd2da526426374328bb59d41a869c46273cfb`

Owned browsers, servers and native/fault processes have completed and closed;
unrelated Chrome PID23192/profile60rjcU and existing untracked evidence were
preserved. This verdict grants only the stated selected native buffer envelope.
Linux guest execution, production negotiation, new image semantics, scanout
and throughput remain outside the claim.
