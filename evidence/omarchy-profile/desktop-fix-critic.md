# Omarchy desktop snapshot — critic checkpoint

Date: 2026-09-09  
Role: fresh critic, read-only runtime review; this file is critic-owned evidence.  
Baseline commit: `6655d8ba3a5006ddcaa26e4debf0221cdd2efe3d` with an intentionally dirty worker tree.  
Scoped diff digest (`git diff -- crates/wasm/src/lib.rs crates/wasm/src/chunked.rs crates/cli/src/boot.rs web/loader.js | shasum -a 256`): `5e9afdf35ec00dd27275594a3cbfc4fe68e62f4ecea47418a4848eb9b7943662`.

No implementation files or task statuses were edited by the critic. GUI cold native/browser captures were still running, so this checkpoint is not a final verification verdict.

## Bounded novel attack — real Chrome seeded-instance isolation

Prediction before execution: two ephemeral machines constructed from the same JavaScript delta must not share mutable generation/coherence state; advancing A must leave B at generation 23. Mutating the caller-owned seed buffer after construction must not alter either machine. Each machine must apply snapshot-generation coherence independently.

Retained attack harness: `tools/verify/omarchy-seeded-isolation.mjs`; SHA-256 `5e29aa26f4e1f2d44692e65ec7807056e86e3684a4eea1d096365eaa0f7ac36c`. This is byte-identical to the originally executed temporary harness recovered from critic history. It launches installed Google Chrome headless, imports the actual built `/pkg/wasm_vm_wasm.js`, builds one valid generation-23 delta, constructs two `WasmLinux.newChunkedDiskSeeded` instances from the same `Uint8Array`, advances only A, mutates the original seed buffer to `0xa7`, and checks both machines' coherence decisions.

Exact commands:

```text
cd /Users/blamy/Documents/Codex/wasm-vm/web
python3 -m http.server 8000

cd /Users/blamy/Documents/Codex/wasm-vm
node tools/verify/omarchy-seeded-isolation.mjs
```

Observed stdout:

```text
OMARCHY_SEEDED_ISOLATION_ATTACK_PASS {"a24":24,"bStill23":23,"bAcceptsOwn":"resume","aRejectsBAt24":"stale","aAfterInputMutation":24,"bAfterInputMutation":23,"aAcceptsOriginalAt24":"stale"}
```

Result: **HELD**. A advanced to 24 while B remained 23; B accepted its own generation-23 snapshot; A rejected B's snapshot at generation 24; overwriting the original JS seed changed neither instance. This attack proves constructor ownership and per-instance metadata/coherence isolation. It does not inspect guest-visible disk-block bytes; existing `MemOverlay` COW unit coverage remains the evidence for that lower layer.

### Retained-harness replay and server provenance

The original critic run did **not** reuse a pre-existing server: an initial `curl` found no listener; the critic's plain `python3 -m http.server 8000` then started successfully and was stopped after the run. On the retained-harness replay, the sequence was different and is recorded without inference:

1. `curl -sS -I 'http://127.0.0.1:8000/?noAutoBoot=1'` initially failed to connect.
2. `bash tools/serve-dev.sh 8000` was then attempted and failed with `OSError: [Errno 48] Address already in use`, showing another owner had acquired port 8000 in the interval.
3. A second HTTP probe returned `200 OK` with the repository dev server's COOP/COEP headers, and the retained harness ran against that existing owner.

Exact replay command:

```text
cd /Users/blamy/Documents/Codex/wasm-vm
curl -sS -I 'http://127.0.0.1:8000/?noAutoBoot=1' && node tools/verify/omarchy-seeded-isolation.mjs
```

Full command stdout:

```text
HTTP/1.0 200 OK
Server: SimpleHTTP/0.6 Python/3.9.6
Date: Thu, 10 Sep 2026 00:34:32 GMT
Content-type: text/html
Content-Length: 67225
Last-Modified: Wed, 09 Sep 2026 20:58:21 GMT
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp

OMARCHY_SEEDED_ISOLATION_ATTACK_PASS {"a24":24,"bStill23":23,"bAcceptsOwn":"resume","aRejectsBAt24":"stale","aAfterInputMutation":24,"bAfterInputMutation":23,"aAcceptsOriginalAt24":"stale"}
```

Actual loaded WASM file (`web/pkg/wasm_vm_wasm_bg.wasm`) SHA-256: `f0df092dd85582eb6bd57bb6acb5b1acb4c00fe6b2f10f3a4907c01c5a5359a7`.

## Carried predictions and review state

### Seeded wrapper and coherence — HELD

- `newChunkedDiskSeeded(..., delta)` validates delta base binding, image length, bounds and duplicates, materializes a fresh in-memory `MemOverlay`, and does not open an IndexedDB overlay.
- Raw resume identity is separate from a persistent database base. A generation-23 snapshot produced by the seeded constructor returns `resume` at generation 23; a mismatched generation returns a non-resume decision.
- Existing real-Chrome constructor evidence reports generation 23, raw snapshot round-trip, expected malformed-delta failures, `persistPending() == 0`, `readStoredSnapshot() == null`, `persistSnapshot()` returning `not_persistent`, and no IndexedDB database-list change.
- The novel two-instance attack above additionally holds caller-buffer ownership and cross-instance coherence isolation.

### Native/browser device topology and RAM snapshot mapping — HELD structurally

Prediction: with native `--net --virtio-rng --browser-topology`, both native and WASM assemble the snapshot-bearing desktop devices in the same order and slots: network 1, RNG 2, keyboard 3, tablet 4, mouse 5, sound 6, GPU 7, console 8. RAM restore requires matching presence for desktop sections and maps serialized device state onto the destination's already-created devices. Host callbacks/sinks are destination-owned rather than serialized.

Review result: **HELD structurally** for current sources. Network is loopback/offline on both paths. GPU, input, sound, RNG, console and transport/ring state are serialized. Compiled host code is not serialized and destination caches are invalidated/reconstructed. This does not replace an actual native-produced candidate restored by the actual WASM build.

### GPU restore to current sink and immediate repaint — HELD conditionally

Prediction: when the saved GPU section has `scanout_resource: Some`, `load_resume` restores resources/scanout/cursor and synchronously calls the destination GPU's currently attached frame sink with one full repair frame before guest execution. If the saved scanout is `None`, no frame is emitted.

Review result: **HELD at core/device level**. The GPU codec emits the full repair frame during restore. The whole-machine desktop resume test observes exactly one frame on a fresh target sink immediately after `load_resume`, before a later guest-driven flush produces the second frame. The source sink remains untouched. Browser loader ordering attaches the display before `loadSnapshotBlob`.

No browser-bound candidate evidence existed at this checkpoint, so native-to-WASM and browser-to-WASM immediate canvas presentation remain evidence-needed despite the structural guarantee.

## Remaining candidate GUI evidence requirements

The prepared `tools/verify/omarchy-restore-repaint.mjs` must run against the frozen real RAM snapshot + matching overlay delta and actual built WASM. Before any `runChunk`/guest execution it must record:

1. Successful actual `newChunkedDiskSeeded` construction and snapshot coherence decision for the pair.
2. `attachDisplay` completed before `loadSnapshotBlob`.
3. A display callback fired synchronously as a consequence of `loadSnapshotBlob`, with zero guest run calls beforehand.
4. Callback geometry/format and byte statistics proving a non-empty, nonuniform frame (not merely a black or uniform buffer).
5. Canvas presentation of that callback and a screenshot of the actual Omarchy GUI.
6. Candidate snapshot/delta/manifest/WASM/harness digests and console/error log, so the screenshot and callback statistics are tied to the frozen artifacts.
7. Separately, the cold native and cold browser capture evidence must establish that the captured desktop met the mapped Foot + Omarchy/Quickshell layer readiness barrier. Synthetic constructor evidence is not GUI proof.

`tools/verify/omarchy-restore-repaint.mjs` was syntax-green per worker report but was not executed by this critic because the RAM pair was not ready.

## Source and harness digests at this checkpoint

```text
922571c26d29ada0d061b15b55133e5f48ccd062fbc856b34b4e11a5a352dcc4  crates/wasm/src/lib.rs
dfa1b450234c1898f06adea4785113813013286eae8ec118c7dfe4bc95c272c1  crates/wasm/src/chunked.rs
9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053  crates/core/src/lib.rs
fb461a3aa21c64afebd53b9dcf25d3ee6a3d10cdad1b680a1388e720a3a9c0c0  crates/core/src/dev/virtio/gpu/snapshot.rs
a9229d84a443d9123bacdaf6958c621afcf539bd26531dad92149753261e1708  crates/core/tests/desktop_machine_resume.rs
7b11c24e3b5b79fa79aef4d5e8fb4077e4d8687189eb11d38509ac6a651f794c  crates/cli/src/boot.rs
1b8b93adf89c4d1660ef87c1235be021343d721a38011a62864c038f918c2e0b  web/loader.js
7e0e97deb0c203d542be80ff4fab4a5f8f9d0556c7cd100c7ada732b536ffc60  tools/verify/omarchy-seeded-wasm.mjs
855ba31a1afa8b5a6cf143c6cba4413a4d9b0bce4671321691d130c7071cd321  tools/verify/omarchy-restore-repaint.mjs
5e29aa26f4e1f2d44692e65ec7807056e86e3684a4eea1d096365eaa0f7ac36c  tools/verify/omarchy-seeded-isolation.mjs
f0df092dd85582eb6bd57bb6acb5b1acb4c00fe6b2f10f3a4907c01c5a5359a7  web/pkg/wasm_vm_wasm_bg.wasm
```

These HELD results may be carried forward only while the cited source/harness and scoped-diff digests remain unchanged. A runtime-semantic change at one of these boundaries requires re-review or re-execution of the affected prediction.

## 2026-09-09 tests/docs-only follow-up

The worker subsequently added duplicate-block and arithmetic-overflow tests and corrected snapshot-base comments, with no reported runtime semantic change. The retained actual-Chrome harness replay above remains green against WASM SHA-256 `f0df092d...359a7`; therefore the seeded-wrapper/coherence runtime prediction remains **HELD**. The topology and GPU restore implementation files were not changed by that tests/docs-only follow-up, so those structural predictions remain **HELD** under their existing candidate-GUI evidence requirement.

Current post-follow-up digests superseding changed textual-source entries above:

```text
9e80025546043c376003c0e323d38290907dda3ef85b4ba3d2ddb7ad79f34a72  crates/wasm/src/lib.rs
b9e7b46a582cff9b76c70707406581af8f34baa60b56cf7836a25a6c593ac3e6  crates/wasm/src/chunked.rs
56f9d7b3971690886c066df458f72b8acdf934a12cdf7a7a386724c5c1e8ad46  scoped runtime diff stream
```

## 2026-09-10 incremental critic checkpoint — actual native-to-WASM immediate repaint

Status: **HELD for the immediate-repaint prediction only; not a final task verdict.** The complete built-demo keyboard/resize/service-worker/same-tab reload proof was still running.

Prediction: the real native-produced RAM snapshot and matching overlay delta will be accepted by the actual WASM build after `attachDisplay`; `loadSnapshotBlob` will synchronously emit exactly one full nonuniform desktop frame before any guest execution.

Independent inspection:

- `evidence/omarchy-profile/immediate-repaint/report.json` SHA-256: `7b2c0063029d2969ae2d2b886a635a574c117d88f5dad16f456fb0558b3448b1`.
- `restored-before-execution.png` SHA-256: `b40e4b834191a7f2b7b366d07df2392fc97bcbc075fdc771e3730b1883da8411`; this matches `screenshotSha256` in the report.
- Harness SHA-256: `855ba31a1afa8b5a6cf143c6cba4413a4d9b0bce4671321691d130c7071cd321`.
- Actual served WASM (`web/dist/pkg/wasm_vm_wasm_bg.wasm`) SHA-256 recorded by the harness: `d33299d93ad7c0f8ef39223145c70b52eee77a8baacd92001ab9e775ebcdbca9`; independently matched against the current built WASM.
- Snapshot gzip: 201,816,185 bytes, SHA-256 `db34afb6f4e0e40b9e8e932cc934847bc254935c374487d521cb2e5a1d704e72`; `gzip -l` reports 892,194,253 uncompressed bytes.
- Delta gzip: 1,207,113 bytes, SHA-256 `d9ac25c5caa8887773f6d8484c85b5c3662c5dd009971522f60cd733ab8e05ed`; `gzip -l` reports 10,867,453 uncompressed bytes and direct header inspection reports 2,648 blocks.
- Kernel SHA-256: `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
- Manifest SHA-256: `ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391`.

Observed report values: restore decision `resume`; display attached; frame count `0` before load and `1` immediately after load; full frame rectangle `0,0 1280x832`; restore duration 1431.54 ms; visible fraction 0.9614896334; 427 sampled RGB colors; no page errors.

The harness source contains no `runChunk`, scheduler creation, or other guest execution call: after construction it attaches the display, checks coherence, calls `loadSnapshotBlob`, and reads the sink synchronously. Its `guestRunCalls: 0` field is a constant rather than an instrumented counter, but static inspection of the complete harness supports that value; the only `runChunk` occurrences are explanatory comments.

Visual inspection of the original-resolution PNG independently confirms an actual composed Omarchy desktop rather than a blank/uniform repair buffer: top workspace bar and status icons, centered clock, bordered mapped Foot terminal at `(12,38)` with an `omarchy@omarchy-demo` prompt and cursor, and the expected dark desktop background. The visible layout is consistent with the native readiness observation (Foot 1256x750, bar 1280x26, background 1280x800).

Result: **HELD.** This closes the prior native-to-WASM immediate GPU repaint evidence gap for the cited frozen pair/WASM/harness. It does not yet prove post-resume guest liveness, keyboard input, resize behavior, service-worker publication, or same-tab reload; those remain assigned to the running complete built-demo proof.

## 2026-09-10 actual-candidate GPU pending-notify falsification

Hypothesis under attack: the native snapshot may have captured a GPU descriptor after Linux advanced `avail.idx` but before the emulator serviced the queue, then lost the non-serialized `GpuState.kicked` bit on restore. Prediction if true: for controlq or cursorq, RAM-resident `avail.idx` would differ from the serialized service cursor `last_avail_idx` before any restored execution.

Method: an owned temporary Node parser read the exact frozen gzip directly, verified snapshot SHA-256 `db34afb6f4e0e40b9e8e932cc934847bc254935c374487d521cb2e5a1d704e72` and kernel SHA-256 `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`, decoded the `WVMRESU1` envelope, parsed GPU tag 12's fixed MMIO transport and queue-shadow prefix, and walked the sparse RAM section only far enough to read each queue's `avail.idx`. It did not construct or execute a guest. Temporary parser SHA-256: `4cbed8dd938165bc1a0a13c41a12d408bf9cc3a240f5b8ab5cef14de1d52968b`.

Exact command:

```text
cd /Users/blamy/Documents/Codex/wasm-vm
node --max-old-space-size=4096 /tmp/omarchy-gpu-queue-probe.mjs
```

Observed queue state before execution:

```json
{
  "snapshotSha256": "db34afb6f4e0e40b9e8e932cc934847bc254935c374487d521cb2e5a1d704e72",
  "kernelSha256": "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce",
  "rawBytes": 892194253,
  "transport": {
    "status": 15,
    "driverFeatures": "4294967298",
    "queueSel": 1,
    "intStatus": 0,
    "lastNotify": 0,
    "notifyCount": "108",
    "hasNotify": true
  },
  "queues": [
    {
      "index": 0,
      "num": 256,
      "ready": true,
      "desc": "0x826f0000",
      "driver": "0x826f1000",
      "device": "0x826f2000",
      "hasView": true,
      "lastAvail": 232,
      "usedShadow": 232,
      "guestAvail": 232,
      "pending": 0
    },
    {
      "index": 1,
      "num": 256,
      "ready": true,
      "desc": "0x826f4000",
      "driver": "0x826f5000",
      "device": "0x826f6000",
      "hasView": false,
      "lastAvail": 0,
      "usedShadow": 0,
      "guestAvail": 0,
      "pending": 0
    }
  ]
}
```

Result: **Prediction FAILED; actual lost-kick hypothesis falsified.** Controlq was fully consumed (`232 == 232`) and cursorq was empty (`0 == 0`) at capture. No saved GPU descriptor depended on a missing notification, so lost GPU kick state cannot explain this candidate's repair-only display. The structural omission remains worth deterministic regression coverage, but it is not the observed candidate failure.

## 2026-09-10 provisional critic checkpoint — SDR-R3 image provenance

Status: **HELD for the image/provenance boundary only; interactive GUI acceptance remains pending and no task status was changed.**

- Frozen profile/tool commit: `dd39c73ca79833b7cc88762278992621a8eca8e0`.
- SDR image: 4,294,967,296 bytes, SHA-256 `2b4143df63085141f7cf017ed2d11c9808bd38dd30925bc86c4a15b4a64cf83c`.
- Split-256 KiB manifest: SHA-256 `5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44`; 16,384 entries and 10,535 unique objects.
- Build receipt SHA-256 `febe0c338c6468d0782691e1e9af1d3ee4afee63d86433fd2939f0be8f905ba2`. Its builder, configurator, sanitizer and demo-session digests independently matched the files at `dd39c73c`; it explicitly records `desktopVerified: false`.
- Integrity log SHA-256 `8020fcd6642383d69bd82af041c882d6d3d7c46b5e9da576ba619cb11b83f39e` binds the image and manifest hashes and reports ext4 bounds/integrity only.
- Tests log SHA-256 `4a27948d72fbcec7dfa8cab39272c03648c9827e75e0b134e8617709e43691bb` reports 106 passing tests and one skip. It does not record the command, test inventory, platform, or skipped-test identity, so those details are not independently established by this file.
- The scoped source change writes only Hyprland's SDR profile (`render.cm_enabled = false`) plus a string-presence test; it does not change emulator FP semantics.

Open tooling issue carried forward: `tools/build-omarchy-snapshot.sh` distinguishes release output using textual equality. An alias such as `OMARCHY_SNAPSHOT_DIR=releases/boot-snapshot/` writes into the release directory but skips release-manifest regeneration. Also, the script still defaults to the old R2 image/chunk paths, so the SDR capture record must show the explicit SDR-R3 environment bindings.

Follow-up path check: the subsequently cited `evidence/omarchy-profile/sdr-build-r3/build-commands.log` and adjacent `build-receipt.json` were not present. The directory still contains only `build-commands-r3.log` (SHA-256 `193e64ff453cb97b8f276dfae7384cdc23cf6b9e4cfaf4f2666a74f625f98b4c`) and `build-receipt-r3.json` (SHA-256 above). The former records the 103 internal chroot/mkfs commands but not the outer test command. Exact command, working context/container identity, and identification of the one APFS skip therefore remain requested from the evidence producer. This does not revoke the image/hash/source-digest metadata HELD result.

Runtime note received separately, not independently replayed here: a physical `A` held for five wall seconds produced no Foot text after three minutes while the guest clock advanced and virtio input IRQ count moved from one to three. This is consistent with input reaching the guest interrupt path but does not prove terminal/seat delivery or GUI interactivity; no finished-task claim follows.

## 2026-09-10 provisional critic checkpoint — immutable chunk publisher

Status: **REFUTED for publication safety; no remote/auth/account operation was performed. Do not publish with this source digest.**

Reviewed uncommitted source digests:

```text
6c3e1c23f7ca21e79f4ce846d1fe56520460d16e56c1bcb51f476ccf416b082b  tools/publish-omarchy-chunks.mjs
ab8474a005d3a4bd423be6f3d3012757dcdcf6231acc5ad4ab5113957a18445b  tools/publish-omarchy-chunks.test.mjs
```

Findings and demands:

1. **Immutable chunk mismatch is overwritten.** `checkPublicObject` returns `mismatch` for HTTP 200 wrong bytes, but `ensureUploaded` rejects only `error` and treats every non-`exact` state as uploadable. The bulk filter likewise selects all non-exact states. This can overwrite a shared content-addressed key and violates the stated 404-only publication boundary. Demand: fail closed on `mismatch` both during preflight and immediately before upload; only `missing` may invoke the uploader, with a regression asserting zero uploads on mismatch.
2. **Preflight retains the complete unique object set in RAM.** Every worker reads a chunk and returns `{ expectedBytes }`; `mapLimit` retains all results until preflight completes. For the observed 10,535 unique SDR objects this retains roughly 2.57 GiB of payload buffers (before runtime overhead), despite concurrency four. Demand: preflight retain metadata/state only and reread a bounded number of chunks during upload, while revalidating hash/size at that point.
3. **GET timeout covers headers only.** `responseWithTimeout` clears its abort timer when `fetchImpl` resolves, before `response.arrayBuffer()` consumes the body. A peer can return headers and stall the body indefinitely. Demand: keep the abort signal/timer alive through bounded body consumption and add a headers-then-stalled-body regression.

Bounded local-only novel attack command:

```text
cd /Users/blamy/Documents/Codex/wasm-vm
node /tmp/omarchy-publisher-mismatch-attack.mjs
```

Harness SHA-256: `a7d55833303af8b0654ff775c3539f15ee6f02485587a7c26ab81eedcb186017`.

The injected public reader returned HTTP 200 with `CORRUPT` bytes for content-addressed key `chunked-omarchy/chunks/97a2fc5541dcc9c06b99b2a84c34961fa0c3af20dba3968df2f96a56c6bc00c9.bin`. Observed uploads, with no network involved:

```json
{
  "uploads": [
    "chunked-omarchy/chunks/97a2fc5541dcc9c06b99b2a84c34961fa0c3af20dba3968df2f96a56c6bc00c9.bin",
    "chunked-omarchy/manifest-2040eede773c05a1d10beb54ad13367e5e6232118de6d7ae613e5f574c64c13b.json"
  ],
  "uploaded": 1,
  "finalManifest": "uploaded-verified"
}
```

Thus the mismatch-overwrite prediction is directly confirmed. The existing test command was also run:

```text
node --test tools/publish-omarchy-chunks.test.mjs
```

Observed: 5 tests, 3 pass, 2 fail because this critic sandbox denies binding `127.0.0.1` (`listen EPERM`). The three filesystem-only tests passed; the two local-HTTP tests were not executed to their assertions. This is an environment limitation, not a semantic test failure, and is not represented as a green suite.

## 2026-09-10 publisher re-audit after first safety fixes

Status: **two prior findings HELD fixed, timeout finding HELD fixed, but publication remains REFUTED by an uploader-handoff integrity gap. No network/auth/account operation was performed.**

Reviewed source digests:

```text
11483c7184af5a62403fec652e2becafce681b06ab1cccad795fac9edad600ed  tools/publish-omarchy-chunks.mjs
1f836027307f9b31c8d3a0e23d791709963cafe427a20b54cbad5fb1bad97311  tools/publish-omarchy-chunks.test.mjs
```

Prior findings:

- **HELD fixed — public mismatch:** both bulk preflight and the immediate pre-upload check reject `mismatch`; only `missing` reaches the uploader. The injected mismatch regression passed with zero uploads.
- **HELD fixed — memory bound:** preflight retains `{object, check}` metadata only. Streaming public reads retain at most one bounded response chunk per active worker; local verification runs at concurrency four without retaining file payload buffers.
- **HELD fixed — body deadline/cap:** one abort/deadline remains active across fetch and streamed-body hashing; the stalled-body and oversized-body regressions passed.

Novel refutation: local files are revalidated and then handed to the uploader by pathname. Mutation after `verifyLocalObject`/`verifyManifestSource` but before or during Wrangler's path read can therefore upload bytes different from those validated. Post-upload verification detects the mismatch but cannot remove the newly poisoned immutable key. Because subsequent runs correctly fail closed on HTTP 200 mismatch, the publisher cannot repair that key. The same race exists for the final manifest pathname.

Exact local-only attack:

```text
cd /Users/blamy/Documents/Codex/wasm-vm
node /tmp/omarchy-publisher-handoff-attack.mjs
```

Harness SHA-256: `ea8957a6ce042829224d1af00a6deb966003c91a6f5fccffb1b1af4f71a9292e`.

Observed:

```json
{
  "error": "post-upload public verification failed for chunked-omarchy/chunks/97a2fc5541dcc9c06b99b2a84c34961fa0c3af20dba3968df2f96a56c6bc00c9.bin: mismatch HTTP 200",
  "remoteExistsAfterFailure": true,
  "remoteSizeAfterFailure": 6,
  "remoteSha256AfterFailure": "500177cd8f619d5c8f903e85c6425a59851bf3434c308163e58f78a2e28c5ec0",
  "futureState": "HTTP 200 mismatch; fail-closed retry cannot repair"
}
```

Demand: upload from a private immutable/staged copy whose bytes are created and hashed under publisher control, not from the mutable source pathname. Apply the same rule to the manifest. Keep post-upload verification as defense in depth and add a regression asserting that a handoff mutation cannot leave mismatched bytes at the immutable key.

Regression command:

```text
node --test tools/publish-omarchy-chunks.test.mjs
```

Observed in the critic sandbox: 13 tests, 11 passed; the two tests that bind `127.0.0.1` failed at `listen` with `EPERM` before their assertions. All injected-fetch/filesystem safety regressions, including mismatch, stalled body, cap, pre-write mutation and post-upload mismatch detection, passed. The main agent's approved-localhost run remains required for the two HTTP-server cases.

## 2026-09-10 final publisher boundary re-audit — staged copies

Status: **HELD for safe immutable candidate chunk/manifest staging under the reviewed boundary; this is not Omarchy GUI/task verification and does not authorize a default URL change. No remote/auth/account operation was performed by the critic.**

Exact reviewed uncommitted source digests:

```text
97254e3e0d103b179b5872903447dfa0e9ef02189bff3e7de4842536e1dd4d86  tools/publish-omarchy-chunks.mjs
92b2fd5ec59fdf4e19c0785bd4c67a67daa9c6f40a347bb6c0bacf0dd03643a2  tools/publish-omarchy-chunks.test.mjs
```

The prior uploader-handoff refutation is closed: each missing chunk is copied with exclusive creation into a private `mkdtemp` directory, the staged copy's regular-file size and SHA-256 are verified, mode is changed to `0400`, Wrangler receives only that staged pathname, the public object is post-verified, and cleanup runs in `finally`. The manifest is separately staged from the already validated in-memory manifest bytes and receives the same verification/read-only/cleanup treatment.

Other reviewed boundaries:

- Public 200 mismatches still fail closed before any write; only 404 reaches staging/upload.
- Preflight retains metadata only and public bodies are streamed with a size cap and deadline.
- 404/error bodies are explicitly cancelled; focused regressions cover both.
- A key that changes from missing during preflight to exact before upload is counted as `racedExisting`, not `uploaded`; `verifiedExisting` remains the preflight-exact count.
- `imageSha256` reconstructs the logical image in manifest order, including repeated content-addressed chunks; validation rejects conflicting reuse lengths.
- Receipts bind manifest SHA/path, reconstructed image SHA/length, exact publisher script SHA, and current Git HEAD. Because the publisher files are currently uncommitted, Git HEAD identifies the surrounding checkout and does not by itself contain the script; the separate script SHA is the authoritative script-byte identity.

Focused worker regression independently rerun:

```text
node --test --test-name-pattern='publisher-owned staged bytes survive original-source poisoning during handoff' tools/publish-omarchy-chunks.test.mjs
```

Observed: 1 test, 1 pass, 0 fail.

Independent local-only poisoning attack:

```text
cd /Users/blamy/Documents/Codex/wasm-vm
node /tmp/omarchy-publisher-staged-source-attack.mjs
```

Harness SHA-256: `94bb8414d8be99558713e2a7c3f8e07ca457777d422f447c7cc02810848eef0d`.

Observed values:

```json
{
  "uploaded": 1,
  "finalManifest": "uploaded-verified",
  "allStagesOutsideSource": true,
  "allStagesReadOnly": true,
  "allStagesRemoved": true,
  "uploadedChunkSha256": "97a2fc5541dcc9c06b99b2a84c34961fa0c3af20dba3968df2f96a56c6bc00c9",
  "expectedChunkSha256": "97a2fc5541dcc9c06b99b2a84c34961fa0c3af20dba3968df2f96a56c6bc00c9",
  "originalNowPoisoned": true
}
```

The attack poisoned the original chunk after the uploader received its path and mutated the original manifest during manifest handoff. Both uploader source paths were outside the fixture tree, had numeric mode `256` (`0400`), retained the expected hashes, uploaded the expected bytes, and were absent after completion.

Full suite command in this sandbox:

```text
node --test tools/publish-omarchy-chunks.test.mjs
```

Observed: 16 tests, 14 pass; the same two localhost-server tests fail before assertions because sandbox `listen(127.0.0.1)` returns `EPERM`. The main agent's approved-localhost execution remains the authority for those two cases. No semantic failure was observed in the 14 network-free tests.

## 2026-09-10 publisher final-source operational re-audit

Reviewed source digests:

```text
7d6554c37c5b8b0b49673676c82ce407fa2ef787537712190e873ef46b1c644a  tools/publish-omarchy-chunks.mjs
008e2100e0b9499a08a5eb45673b929ac0ad9367b074285b451480384d8064db  tools/publish-omarchy-chunks.test.mjs
```

**HELD:** immutable-byte publication safety remains intact. Chunk and manifest uploads still use verified private staged copies; mismatch/404 policy, bounded-memory preflight, raced-existing accounting, image reconstruction hash, provenance receipt, and post-upload verification are unchanged from the previous HELD checkpoint.

**HELD:** 404 and non-200 response bodies are aborted and disposal is raced against the same request deadline. Focused regressions for ordinary cancellation and a cancellation promise that never settles both passed within the bound.

**Operational finding:** `cleanupStage` removes the staged file and directory but suppresses errors from both operations. The happy-path regression asserts that both disappear, but the implementation does not assert cleanup: an uploader-created extra entry, permission failure, or failed file removal makes `rmdir` fail silently and the operation can still report publication success while retaining the private stage directory. This does not alter the bytes uploaded or permit mutable-source poisoning, but it contradicts a strict cleanup guarantee. Demand: make cleanup failure observable (while preserving any primary error), or deliberately and safely remove the exact publisher-created private directory recursively; add a sabotage regression that leaves an extra entry and verifies the selected policy.

Commands:

```text
node --test --test-name-pattern='publisher-owned staged bytes|404 and non-200|stalled status-body disposal' tools/publish-omarchy-chunks.test.mjs
node --test tools/publish-omarchy-chunks.test.mjs
```

Observed: focused 3/3 passed. Full suite: 17 tests, 15 passed; the two localhost-server cases again failed before assertions with sandbox `listen EPERM`. The main agent's approved-localhost 17-test run remains required.

## 2026-09-10 incremental publisher retry/cancellation audit vs `2eca1b1d`

Status: **HELD for read-only preflight retry/cancellation and no-write failure safety; no remote operation was performed.** Exact stable reviewed digests after an initial concurrent source change:

```text
49e7b3c7bb64ee6be5bd205ac782caa5364ec85588bc28954a04c5e0bc5d5131  tools/publish-omarchy-chunks.mjs
6d9d792e925547d9528fd1e8c234bae9eaf146e1bcaefc90005bcc284d4c7c48  tools/publish-omarchy-chunks.test.mjs
```

The first hashes observed during this audit were different because the files changed while being inspected; two subsequent hashes one second apart matched the values above. Publication evidence must bind the eventual committed/frozen digests, not the earlier transient bytes.

Reviewed behavior:

- Each public-object attempt has a 20-second header/body deadline and aborts/cancels a pending stream read on expiry. Network exceptions and HTTP 429/5xx retry up to three total attempts with 500/1000 ms backoff. A fully exhausted default object check is therefore bounded to roughly 61.5 seconds plus scheduling/disposal overhead.
- HTTP 200 byte/size mismatch, malformed non-streaming HTTP 200, 403, and other non-429/non-5xx statuses do not retry. Mismatch remains fatal before writes.
- Error/status response bodies are cancelled with bounded disposal before retry/return.
- Preflight concurrency is 16; upload concurrency remains four. Preflight performs no writes.
- `mapLimit` stops assigning new indices after the first observed fatal error and awaits all already assigned workers before returning the fatal error. In-flight requests are not globally cancelled; they remain individually bounded and cannot upload during preflight. Thus a fatal preflight can wait for up to the longest in-flight retry budget, but cannot race into a write.
- The retry wrapper is also used for immediate pre-upload race checks and post-upload verification. A key filled with exact bytes between preflight and upload is counted under `racedExisting`, while `verifiedExisting` remains the preflight-exact count.

Focused command covered timeout, transient recovery, fatal no-retry, assignment stop/drain, and status-body disposal: 6/6 passed. Full critic sandbox command reported 20 tests: 18 passed; only the two tests requiring `listen(127.0.0.1)` failed before assertions with `EPERM`. The main agent's approved-localhost run remains required for those two actual HTTP-server paths.

No retry/cancellation defect was found that could turn the reported timeout-only candidate attempt into a write: publication does not leave preflight until every assigned check resolves successfully and the complete preflight result has no fatal/mismatch.

## 2026-09-10 incremental FP hot-PC evidence inspection

Status: **useful attribution evidence, but final CLI/policy review remains deferred pending the requested browser-region map. No JIT/FP semantic change is supported yet.**

Evidence directory SHA-bound files include `diagnostic-summary.json` SHA-256 `6d48862dd84d7ee6f6698d069e324ced33ce772c59d49d88e7ad3b27cb4f8478` and spawn provenance SHA-256 `c9ac5a6e42d93b556e872daca0e06cb9a5b7f4322bef82a9230dfb667960fe4c`. The run reproduces the prior 9,999,379-retirement trace/hash/state and 849,572 FP-compute count.

The uncapped 64-byte region table accounts for all 9,999,379 retirements and all 849,572 FP-compute retirements across 6,055 regions, 156 of which contain FP compute. It demonstrates genuine concentration: for example, region `0x00007fffa4233780` has 37,572 FP-compute of 46,965 total retirements (80%), and multiple adjacent `0x00007fffa42335c0..3980` regions have tens of thousands of FP-compute retirements with roughly 22–75% local shares. This is stronger than an aggregate-only histogram.

The pair top-32 tables are not complete heavy-hitter proofs: their first-seen map reached its 65,536-pair cap and dropped 426,862 retirement records belonging to later unseen `(pc,raw_insn)` pairs. The uncapped region table—not top-32 pair rank—is therefore authoritative for concentration.

The specifically requested region `0x00007fffa4229b40` was not retired in this first 10M window; its nearest observed region had no FP compute. Observed FP-hot regions are at different addresses. Whether those regions map to the browser renderer and whether their surrounding blocks would otherwise be JIT-eligible remains pending Epicurus's bounded region map. Existing side-exit-all policy is not yet refuted.

## 2026-09-10 scoped closure — CLI FP diagnostic tooling

Status: **HELD for bounded diagnostic count accuracy and evidence labeling only. No FP policy, performance, renderer-root-cause, core, or WASM claim is made.**

Final reviewed source:

```text
def00109d1e7c9292641b74a42a0f16fd62d5cd753e640486359e4c19ec144f1  crates/cli/src/boot.rs
```

The final CLI-only sink keeps both potentially growing structures bounded at 65,536 entries. Existing admitted `(pc,raw instruction)` pairs and 64-byte regions continue accumulating exact counts after saturation; only retirement records introducing unseen keys beyond the respective cap increment `pair_hist_dropped` or `region64_dropped`. The output explicitly reports each retained-map size and drop count, so consumers can distinguish complete from admission-truncated histograms. Overall opcode, FP class, trace hash and retirement totals remain independent of either cap.

Boundedness audit SHA-256 `c58881352decfeb1c7eca6e03168ed22590cba130937762410a0b36d2dae484b` binds source SHA `def00109...`, spawn provenance `c9ac5a6e...`, command `de51b4a1...`, recording summary `6d48862d...`, and evidence `656a5e10...`. Reuse of the unmodified 10M recording is sound for the region table: it observed only 6,055 distinct 64-byte regions, far below the new 65,536 cap, so the cap would drop zero region records and cannot alter any recorded region total. The pair table was already saturated at 65,536 with 426,862 later unseen-pair retirement records dropped, and remains explicitly identified as admission-truncated.

Independent focused command:

```text
cargo test -p wasm-vm-cli fp_share_sink_tests -- --nocapture
```

Observed: three focused main-binary tests passed, zero failed. The new saturation test inserts 65,537 unique pair/region keys and observes exactly 65,536 retained plus one dropped record in each map. The prior composite HashSink/count and evidence-mode matrix tests also remain green. Filtered integration binaries ran zero selected tests, as expected from the name filter.

Reported broader gates—58 main unit, seven relay unit, 41 integration passing with 11 historical boots ignored; GPU-trace all-target clippy `-D warnings`; formatting—were not independently rerun in full by this critic, but are consistent with the scoped focused result. No count/boundedness issue remains that blocks accepting this diagnostic tooling. FP-hot code mapping remains optional follow-up measurement, not a prerequisite for tooling count accuracy.

## 2026-09-10 bounded CLI FP post-resume diagnostic review

Status: **HELD as a diagnostic measurement; policy re-open condition is not yet fully established and no FP/runtime semantic change is justified.**

Reviewed diff: CLI-only composite `FpShareSink` + histogram/evidence labeling and two focused unit tests in `crates/cli/src/boot.rs`. Production behavior remains opt-in behind `WASM_VM_FP_HISTOGRAM`; selecting the record sink prevents JIT execution even when `--jit` is present.

Evidence directory: `evidence/omarchy-profile/fp-resume-diagnostic-r2-10m-release`.

Internal accounting checks:

```text
opcode7 sum                 9,999,379 == total_retired
fp_ldst + fp_compute        270,144 + 849,572 = 1,119,716 == fp
FP total share              11.197855%
FP compute share            849,572 / 9,999,379 = 8.4962476%
OP-FP funct7 sum            769,580 == opcode7[0x53]
FMA opcode-family sum       79,992
OP-FP + FMA                 849,572 == fp_compute
trace_retired               9,999,379 == total_retired == irq stats retired
```

The release evidence reports `trace mode=retirement-records`, FNV64 `71287438799aa6f1`, state SHA-256 `802e862f976eb63e77bd6019b735673c08ccde3341a07f0de1c58494a21601f7`, and `MaxInstrs`. Runtime stats report `jit_active=true` but `blocks_executed=0` and `retired_via_jit=0`, consistent with the concrete trace sink forcing interpreter retirement records. The earlier debug summary reports the same counts/hash/state; its old `jit-retired-counter-only` label is explicitly superseded by the corrected release evidence.

Classifier review: OP-FP (`0x53`) is correctly indexed by bits 31:25 (`funct7`). Fused operations are correctly kept separate by their seven-bit primary opcodes (`0x43/0x47/0x4b/0x4f`), because they do not share OP-FP's funct7 interpretation. The names are internally precise: `opcode7`/`fma_opcode7` mean the seven-bit primary opcode, while `op_fp_funct7` explicitly means bits 31:25. This sample contains only `0x43` among FMA families.

Focused tests: the composite sink test independently feeds the same records to `HashSink` and confirms count/hash parity; the evidence-mode matrix confirms FP histogram wins over both JIT and display counter-only labels. Critic invocation reached both tests with 2 passed, 0 failed. The synthetic unit coverage exercises OP-FP, LOAD-FP, MADD, integer and compressed non-FP, but not the other three FMA opcodes or positive compressed FP forms; that is a bounded coverage limitation, not a contradiction of this observed sample.

Evidence provenance gap: `command.txt` line 9 records `--evidence evidence/omarchy-profile/fp-resume-diagnostic-r2-10m/evidence.txt` (the debug directory), while the cited corrected artifact is `fp-resume-diagnostic-r2-10m-release/evidence.txt`. Therefore the recorded command does not directly reproduce the cited release evidence path, and debug/release evidence-file parity cannot be treated as a clean independent replay solely from these files. Correct the command record or provide the exact wrapper/postprocessing transcript; no rerun is needed if the existing release artifact's derivation can be bound honestly.

Follow-up: this provenance gap is **closed** by `evidence/omarchy-profile/fp-resume-diagnostic-r2-10m-release-final/actual-spawn-provenance.json` (SHA-256 `da50a9f84ef8a0b8addaee0cf0e0be71e0f0c98072c575181ac52cce6eaf1df2`). It records cwd, environment override, exact argv, absolute release-final evidence/stdout/stderr destinations, start/finish timestamps, exit 102 and no signal/error. Its argv and adjacent `command.txt` both target `fp-resume-diagnostic-r2-10m-release-final/evidence.txt`; that artifact retains FNV64 `71287438799aa6f1`, 9,999,379 retirement records, state SHA-256 `802e862f...01f7`, and `MaxInstrs`. The corrected command-path prediction is HELD.

Policy result: the 8.496% dynamic FP-compute share exceeds the policy's numeric example threshold (>5%) in a real post-resume Omarchy window, so it is sufficient to reopen *measurement investigation*. It does not yet satisfy the complete documented condition, “in a hot loop that the JIT would otherwise carry”: this aggregate histogram has no PC/basic-block attribution, and the concrete sink disables JIT (`blocks_executed=0`). A bounded next falsifier is an FP-PC/basic-block heavy-hitter profile for the same post-resume window, mapped against JIT eligibility. Until that identifies concentration in an otherwise-JIT-eligible hot loop and a material cost, the existing side-exit-all policy is not refuted.

The preparation explicitly zeroes private snapshot core/base identity only for this local diagnostic. That weakens it as acceptance/coherence evidence but does not contaminate the instruction-share measurement; it must not be cited as native/browser resume acceptance.

## 2026-09-10 incremental visual checkpoint — held physical input eventually visible

Status: **HELD only as a falsification of total keyboard/input loss; not interactive-GUI acceptance.**

Independent digest and visual inspection:

```text
fde9836660aafda6d447dd9baca75d9a42c33df75bbaf17bb9558687703a5c7d  evidence/omarchy-profile/input-held-baseline/held-input-after-thirteen-minutes.png
b15a02d175a039c3cc6e953c153cc9097592c3853dcb8f38acdbb2bbe1e2f67e  evidence/omarchy-profile/input-held-baseline/diagnostic.json
```

The original-resolution screenshot visibly shows `ab` after the Foot prompt with the cursor following `b`, on a composed desktop with bar and terminal. The diagnostic records the `a` input request at `2026-09-10T02:38:04.798Z`, `b` at `02:42:22.001Z`, and this screenshot at `02:50:36.660Z`. Thus the screenshot is 12m31.862s after `a` and 8m14.659s after `b`. The earlier `held-key-after-five-minutes.png` is timestamped `02:41:08`, only about 3m03s after `a`, and visibly lacks the glyph; its filename is not used as timing evidence.

Prediction that the restored browser guest has total keyboard transport/seat loss: **FAILED.** Both requested glyphs ultimately became visible in the focused Foot surface, establishing eventual end-to-end delivery and repaint for these inputs.

Limit: this evidence does not localize the delay to rendering. The attempted direct `/dev/input/event0` reads failed with permission denied, so it cannot timestamp kernel consumption, libinput/seat delivery, Foot processing, or compositor presentation separately. The defensible finding is extreme end-to-end input-to-visible-output latency. It remains incompatible with interactive acceptance and does not prove a responsive keyboard path, nonce command completion, resize, or reload.

## 2026-09-10 bounded follow-up — restored scanout rectangle provenance

Status: **FOLLOW-UP only. Not an input-latency root-cause finding, acceptance expansion, or frame-codec change.** The active SDR capture was not inspected or interrupted.

Evidence digests:

```text
120336745740ac07a8d96f2b98093a6c2684830d96d22aa7e40b8b34d21081b3  evidence/omarchy-profile/startup-warmth-baseline-r2-interactive/diagnostic.json
b14847d65422248d0debc702066c5dac039431afc48be61ac380767c0573b4d1  evidence/omarchy-profile/startup-warmth-baseline-r2-interactive/startup-a.png
```

The diagnostic records a fixed 1280x800 browser viewport, one successful Canvas2D present, and exactly 4,096,000 drawn bytes (`1280 * 800 * 4`). Its retained source frame is 1280x832 with a full-resource origin-zero rectangle, and `sizeMismatch=true`. The screenshot visibly contains the Omarchy bar and Foot within the 1280x800 projection.

The observed presentation is an explicit top-left crop, not evidence that the guest selected a 1280x832 display mode: `fitFrameToViewport` copies `min(viewport, resource)` rows and columns into a viewport-sized buffer. For this origin-zero candidate, clipping the 32 excess backing-resource rows is appropriate.

The bounded provenance gap is that virtio-gpu decodes and validates `SET_SCANOUT.rect`, but `GpuState` and its snapshot retain only `scanout_resource`. Restore therefore synthesizes an origin-zero rectangle covering the entire 1280x832 resource. Consequently, the restored callback cannot establish whether the pre-capture guest scanout rectangle was 1280x800 or 1280x832, and `PresentationController.sizeMismatch` compares the painted backing-resource dimensions against the 1280x800 viewport even though the fitted 1280x800 image was successfully drawn. Treat `sizeMismatch=true` here as a resource-versus-viewport telemetry limitation, not proof of a failed guest modeset.

Follow-up boundary: if exact scanout/modeset agreement later becomes necessary, preserve and report the validated `SET_SCANOUT.rect` independently of resource allocation dimensions. This observation does not explain the input delay and does not alter the current GUI acceptance criteria.

## 2026-09-10 fresh critic checkpoint — E5.5-T03b mixed FP/integer regions

Status: **PARTIAL HELD / NEEDS EVIDENCE. No task verdict, deployment claim, or browser-responsiveness claim.** Prior unrelated snapshot, integrity, immediate-repaint, and eventual-input findings remain carried forward unchanged.

Predictions recorded before source/evidence inspection:

- every decoded cache entry is homogeneous FP or integer and excludes the boundary instruction;
- a compiled integer prefix commits exactly once before an FS=Off trap at the exact FP PC;
- mixed 16/32-bit and page/SMC seams preserve state and retirement;
- FP entries remain uncompiled while neighboring integer entries actually retire through JIT;
- added FP-region boundaries remain deterministic under tiny caches and interrupt batching.

Reviewed identities:

```text
5a76e24d9b4a01164b5312f0bf36720240b2d5bca4a6d1c94511d82934b3d432  crates/core/src/lib.rs
07d33129594abf1677eebc759a0eec02fbde364d3aaed05bee84248ec22859ff  crates/core/src/hart/mod.rs
3408c6395cd113f3316601748c4aa1e2f42091e953ef4bf37e9ccfcca064f9dc  crates/jit-runtime/tests/mixed_fp_regions.rs
03a0af3b876a86c588eeefd50b3b4f9fec0283c78f7aa19d2dbbf3bd7f5b659d  tasks/epic-5.5-omarchy/E5.5-T03b-mixed-renderer-blocks.md
```

Acceptance command:

```text
cargo test -p wasm-vm-jit-runtime --test mixed_fp_regions
```

Observed: 9 passed, 0 failed, 0 ignored. The tests establish interpreter/JIT final-state and retirement parity for mixed F/D/C arithmetic, valid compressed FP load/store, alternating and middle-entered regions, a page-edge FP seam, an FS-Off trap after an actually compiled/retired integer prefix, continuation SMC invalidation/recompilation, and deterministic execution with cache capacity one. Assertions also show integer entries compiled, FP entries did not, and aggregate JIT retirement was nonzero.

Bounded novel attack:

```text
cargo test --release -p wasm-vm-jit-runtime --test mixed_fp_regions
```

Observed: the same 9 tests passed, 0 failed, 0 ignored under optimized release compilation. No debug/release-sensitive writeback, trap-PC, SMC, or retirement divergence was exposed.

Missing proof is exact and bounded. The task requires faulting memory, but this file's compressed FP load/store uses valid DRAM and its precise-fault test is FS=Off, not an FP load/store access fault. Add an invalid/misaligned FP memory operation at a mixed-region handoff and compare cause, `tval`, PC, prior integer writeback, FP state, and retired count after the prefix actually retired through JIT. The task also requires preservation of the interrupt-latency bound: cache-capacity determinism compares final state/counters without arming an interrupt, so it cannot establish the new FP/integer seams' sampling behavior. Run or add the named affected predecode/interrupt boundary proof with an interrupt pending across an FP seam.

No concrete runtime contradiction was found in the reviewed partition. Rounding coverage currently demonstrates NaN boxing and NX from default rounding; if the worker claims broader rounding-mode coverage, the final evidence must identify the non-default rounding case rather than relying on this nine-test file.

Housekeeping follow-up: `rustfmt --edition 2024` changed only the test source formatting. Runtime source identities remain `5a76e24d...d432` and `07d33129...9ff`; the formatted test identity is updated above. `cargo fmt --all -- --check` passes. The formatted file still has nine tests and adds neither a faulting FP memory access nor dynamic/non-default `frm` coverage, so the two proof gaps remain unchanged without restarting the held review.

## 2026-09-10 browser outcome — mixed-region partition is not the desktop fix

Status: **REFUTED only for material Omarchy desktop improvement.** This does not overturn the partial architectural HELD result above and is not a task-verification or deployment verdict.

Frozen evidence identities:

```text
a2b78916130cf214903bd745479b25c698bdab2fd37bfd2812cc93b03522afe7  evidence/omarchy-profile/mixed-renderer-candidate-r1/browser/diagnostic.json
a393ca63eef8c451b99b205b8aa35e76ec087e71d02c6bfcb83fe20fa886e3bc  evidence/omarchy-profile/mixed-renderer-candidate-r1/browser/single-key-0521.png
97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f  evidence/omarchy-profile/mixed-renderer-candidate-r1/browser/desktop-input-followup.png
2a0fbc7260684c48b877d65dbf70684a3c2a52adfe538daa034f9f69e1dd2256  evidence/omarchy-profile/mixed-renderer-candidate-r1/browser-cap256/diagnostic.json
58f3580c5a5652baa5b7a20d854ca634975b9ce5992ef5897061f79f810bdfd3  evidence/omarchy-profile/mixed-renderer-candidate-r1/browser-cap256/resized-960x600.png
```

The default-profile candidate records physical `x` at `05:10:38.051Z`, absence at `05:17:52.252Z`, and a screenshot visibly containing `x` at `05:21:15.828Z`. Its measured input-to-visible interval is therefore `(434.201, 637.777]` seconds. The 18-character physical echo command was sent at `05:03:50.773Z`; its `/tmp/gui` file remained absent at `05:21:19.942Z`, with reported host-input drop counters at zero. Roughly 50% JIT share and about 20.08 billion retired instructions demonstrate execution but do not satisfy responsiveness.

Independent original-resolution inspection confirms `single-key-0521.png` contains the typed `x` in the real Foot surface. It also confirms `resized-960x600.png` is a top-left crop rather than an adopted 960x600 guest layout: the top-bar clock remains near x=640 rather than centering near x=480, and the right side is cut off. Thus the resize criterion is not fulfilled.

Conclusion: the mixed FP/integer partition may remain an independently useful and semantically reviewable JIT change, but this actual paired R3 browser run does not materially improve the recorded renderer/input bottleneck and must not be promoted as E5.5-T03a's desktop fix. Responsive physical nonce and true resize evidence remain needed; production remains unchanged.

## 2026-09-10 incremental architectural closure — E5.5-T03b final 13-test boundary

Status: **ARCHITECTURAL HELD only. No task verdict, product-value recommendation, deployment claim, or desktop-fix claim.** This supersedes only the bounded proof gaps in the earlier nine-test checkpoint; the browser lack-of-benefit finding remains unchanged.

Reviewed identities:

```text
5a76e24d9b4a01164b5312f0bf36720240b2d5bca4a6d1c94511d82934b3d432  crates/core/src/lib.rs
07d33129594abf1677eebc759a0eec02fbde364d3aaed05bee84248ec22859ff  crates/core/src/hart/mod.rs
6477716f83132433d63ddd50a5b215a73bf903bf1bd181b502635c4b2601ab31  crates/jit-runtime/tests/mixed_fp_regions.rs
7f84a4bec79bbba97d2f329beea601f8937e77ee9b91207a74d54de88abf6894  evidence/omarchy-profile/mixed-renderer-candidate-r1/worker-tests.log
```

The runtime hashes are unchanged from the partial review. The expanded test file closes its exact missing seams:

- faulting `fld` and `fsd` after an actually compiled and retired integer prefix compare full interpreter/JIT snapshots and assert precise cause, `tval`, FP PC, and retirement count;
- dynamic `frm` values 0 through 4 exercise RNE, RTZ, RDN, RUP, and RMM through an FP handoff, preserve a seeded sticky NV flag, add NX, retain full state parity, and prove a rounding-sensitive RDN/RUP difference;
- a pending timer interrupt at the FP seam is repeated twice at deadlines 8, 20, and 32, with exact tuple equality, one interrupt, precise `mepc` at the unexecuted FP sentinel, unchanged sentinel state, and delivery bounded by `MAX_BLOCK_OPS` after integer JIT retirement.

Independent commands:

```text
cargo test -p wasm-vm-jit-runtime --test mixed_fp_regions
cargo test --release -p wasm-vm-jit-runtime --test mixed_fp_regions
```

Observed in both profiles: 13 passed, 0 failed, 0 ignored. The release-profile replay is the bounded novel attack against the final 13-test identity; it exposed no optimization-sensitive fault state, rounding/flag, interrupt-PC, writeback, SMC, or retirement divergence.

No remaining concrete architectural contradiction was found in the reviewed partition boundary. This result establishes only the tested semantic capability. The eager threshold-1 browser probe's 2.86% JIT share and roughly 70,000 overflow drops do not supply product-benefit evidence and do not alter the existing finding that the partition failed to make Omarchy usable.

## 2026-09-10 fresh source checkpoint — E5.5-T03c rendering recovery

Status: **SOURCE HELD / NEEDS ACTUAL BROWSER EVIDENCE.** Scope is coherent R3 restore rendering, immutable artifact selection, and host-side viewport fitting. No responsive-input, guest-modeset, usable-desktop, Epic-completion, deployment, or task-verification claim is accepted. The WIP rendering harness is excluded until frozen.

Reviewed identities:

```text
e1e66178b5f2a622da7e0f887497643c1cdd6261310dd38a3429ce8a6119d5b8  web/src/sink/viewport.js
0b31fd8b140fcf0bb0c7e9a0a709426c580076f5655ae75cc302076e69067af7  web/loader.js
a9892121acc2072668c0150419e9f2fc91e4bd991886757c0d8d27e58ef63757  web/main.js
a8a71b8bf5503872156945a262f36a0234c7e1ba0225924b04d8616aa3c70b7a  tools/gen-omarchy-manifest.sh
430a207f534977e08d9e46fbbba08de9611daadcf4635a399b1d64bedaa8375a  web/artifacts-omarchy.json
3a51033aa8b4757442c63905220ae775d51bff418d0ab8c646658a00e6d9b06f  web/tests/e5-t22b-viewport.test.mjs
5aaf525df0929a17713d25442c0bbf1be576a2d58782eed4d15968f78969a995  web/tests/omarchy-seeded-loader.test.mjs
4754ebed9d505701ed85850b76e79eb45afc5f2e67f406624daa518fed60e040  tools/gen-omarchy-manifest.test.mjs
721a0ab0a63e0efb590a8c5d226dc5f0687f62ce97a064cf0b98722256693a8f  evidence/omarchy-profile/rendering-recovery-r1/make-ci.log
```

The mixed FP/integer runtime partition is absent from the current core diff. The release pair matches the declared R3 identities: raw chunk manifest `5f6a0809...f23d44`, RAM gzip `2231a21e...9235f5`, and delta gzip `1f56d0bd...b7e7da`.

- **Fixed backing and CSS fit — HELD at source/unit level.** The desktop mode always returns a bounded 1280x800 backing while recomputing only the 16:10 CSS projection. Same-backing resizes update canvas style without clearing pixels or another hotplug. The origin-zero frame fitter crops a restored 1280x832 resource to 1280x800; this is host projection, not proof of guest modeset.
- **Pointer inverse — HELD at source/unit level.** Omarchy's pointer host is the centered canvas itself and the active bridge reads that canvas rectangle, excluding flex letterbox space. The focused unit case maps corners and midpoint. The controller's separate container-based `pointerRect()` is not the active `main.js` input path.
- **Immutable selection — HELD at source/unit level.** The descriptor key is restricted to `chunked-omarchy/manifest-<same sha256>.json`; positive safe size and nonempty base are required. Raw byte length and SHA-256 are checked before fatal UTF-8 decoding. Requested Omarchy resolution has no mutable-manifest fallback; Alpine keeps its explicit path.
- **Pair generation — HELD at source/unit level.** The generator derives raw manifest identity and canonical disk base from the tracked manifest, validates WVOD1 image length/base/generation against WVMRESU1 base/generation before writing, and emits the immutable raw-hash key. Pretty/raw and mixed-pair tests cover the prior generator failures.
- **Claim boundary — HELD.** UI and roadmap text label input as minute-scale/slow and the capability as in progress.

Independent command:

```text
node --test web/tests/e5-t22b-viewport.test.mjs web/tests/omarchy-seeded-loader.test.mjs tools/gen-omarchy-manifest.test.mjs
```

Observed: 25 passed, 0 failed, 0 skipped. The recorded `make ci` failure is not attributed to this boundary: its macOS seccomp syscall and unchanged all-features dead-code walls remain outside this finding.

Required evidence: bind page/SW/WASM/boot descriptor/chunk manifest/RAM/delta hashes in the actual built-browser report; show a nonuniform real restored desktop before guest execution where claimed; show it after fresh same-tab reload; resize and prove a complete aspect-fitted 1280x800 host projection rather than the earlier top-left crop; and exercise centered/corner pointer mapping on the real scaled canvas. Production claims require the same observations against the deployed origin. Screenshots prove rendering recovery only and cannot discharge the separately blocked physical-input criterion.

## 2026-09-10 frozen harness sufficiency review — E5.5-T03c local run

Status: **NEEDS EVIDENCE / TWO HARNESS GAPS.** The active local browser run was not inspected, attacked, or interrupted. Runtime/source findings above remain HELD. This section reviews only the frozen evidence instrument.

Harness identities:

```text
4b2e31feece812e583dcf459242a0aa570865bc675935915b8ad4e1006ce9d8d  tools/verify/omarchy-rendering-recovery.mjs
0993aae8a626434ee051c8190ed3b34b095596572970a42b5f3b730eb8943550  tools/verify/omarchy-rendering-recovery.test.mjs
d16015b8f4466a91a3c0e66dac0fe7fbfb08abf497920482c1fa741f578b32ad  web/dist/sw.js
c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305  web/dist/pkg/wasm_vm_wasm_bg.wasm
```

Independent bounded checks:

```text
node --test tools/verify/omarchy-rendering-recovery.test.mjs
node --check tools/verify/omarchy-rendering-recovery.mjs
```

Observed: one wrapper test passed and syntax passed. The test exercises helper classification/path functions and source-presence assertions; it does not sabotage the orchestration assertions below.

- **Per-phase artifact identity — INSUFFICIENT.** Prediction: initial and reload phases must each contain matching kernel, RAM, delta, and immutable base-manifest responses. Observation: lines 443–447 search all `responseHashes` without filtering by `phase`. A valid initial response can therefore satisfy a role absent or mismatched on reload, despite the task's same-tab reload identity claim. Demand: assert all four expected digest/size matches independently for `initial` and `reload`, and add a focused record-set test where one reload role is missing.
- **Active service-worker bytes — INSUFFICIENT.** Prediction: the controller serving the run is build `347161e9e2b8`, with content bound to the frozen `sw.js`. Observation: lines 303–313 record only controller/registration URLs and cache-key strings; lines 315–327 hash a page `fetch("sw.js", {cache:"no-store"})`. Equal URLs and an explicit fetch do not prove the already-active controller at that URL executes those fetched bytes, and no assertion binds the expected build token to the active cache/controller. Demand: bind the frozen build token to the active registration/cache lifecycle (or force/update and wait for the intended controller before capture), then test a stale-active-controller/current-network-script mismatch.
- **Rendering geometry and pointer evidence — SUFFICIENT for the narrow host claim.** Each viewport requires a nonblack/nonuniform 1280x800 backing, a wholly contained 16:10 CSS canvas, and physical Playwright movement producing expected normalized tablet frames from the actual canvas rectangle. The helper correctly labels this as host-frame mapping only and does not claim guest pointer processing.
- **Immediate-before-execution repaint — NOT COVERED.** The helper waits for `wvm:desktop-ready` and records no guest-run-call count. This is acceptable only if T03c claims eventual rendering recovery; it cannot independently renew the earlier immediate-repaint claim for WASM `c48e9c2d...`, whose binary identity differs from the previously cited R3 immediate-repaint run.

The local run may remain useful evidence for screenshots, geometry, restore flags, source/WASM response hashes, and absence of browser errors. It is not by itself sufficient for a frozen reload-artifact or active-service-worker identity claim until the two bounded harness gaps are closed. No task status is changed.

## 2026-09-10 local actual run — visual boundary retained despite recorder failure

Status: **VISUAL/GEOMETRY/POINTER HELD; BYTE-PROVENANCE RECORDING FAILED. No task verdict.** Report SHA-256: `ec84e0f4e8a6541b79b36988261258c9347059ea670fbf7d1e7a921d34f92e3b`.

The failed report still independently records both initial and same-tab reload with `restoredFromBootSnapshot=true`, one real desktop-ready event, two received/two successful presents, 61 sampled colors, 33,031 visible samples, no presentation errors, and the sole active cache build `347161e9e2b8`. Initial and reload source/WASM/metadata identities are equal; WASM is `c48e9c2d...b9305`. The five retained screenshots have recorded SHA-256 values and were visually inspected by the main session. Geometry is exact at 960x600, centered 600x375 inside 600x900, and centered 1728x1080 inside 1920x1080, always with a 1280x800 backing. Physical Playwright pointer moves at 25%, 50%, and 75% produced the exact expected 8192/16384/24575 tablet coordinates in all three resized projections. These observations survive the later provenance assertion failure.

The recorder failure is real and must remain visible: `Network.getResponseBody` could not retrieve dedicated-worker `linux-worker.js` and evicted the large kernel/RAM bodies; four corresponding `ERR_ABORTED` records were retained. The report therefore correctly ended `failed` and has no `assetMatches`. Those failures must not be silently dropped or relabeled as successful worker byte captures.

An honest replacement can use two explicitly separate statements:

1. **Actual worker integrity pass.** Record the worker request URL/status/completion metadata and the real runtime's successful restore flag. Bind that observation to the hashed loader/worker source whose fail-closed path hashes the immutable base manifest before decode, hashes kernel/delta/RAM before construction/restore, and cannot set `restoredFromBootSnapshot=true` after a failed fresh-desktop integrity check. This is source-grounded evidence that the bytes actually consumed by the worker passed the declared checks; it is not a captured copy of those bytes.
2. **Independent full-byte provenance fetch.** Fetch each exact descriptor URL through a bounded read-only path after each phase, consume the complete body, and record URL, status, byte count, and SHA-256 against the boot descriptor. Label these records `provenanceFetch` (or equivalent), never `workerResponse`/`consumedBytes`. On production, preserve the time and origin because mutable RAM/delta URLs make this a contemporaneous availability check, not proof that the independent fetch is byte-for-byte the earlier worker transfer.

Protocol `loadingFinished`/transfer length alone is insufficient for content identity, but is useful to establish that the observed dedicated-worker request completed. Conversely, the explicit provenance hash alone is insufficient to prove worker consumption. The two evidence legs plus the fail-closed runtime state form a defensible chain without fabricating an inspector body hash.

Cancellation handling must stay fail-closed and classified. Keep every canceled/evicted record in the report, distinguish the known inspector/observation failure from an actual loader error using initiator/session/request identity where available, and require the real worker integrity/restore outcome independently. Do not blanket-ignore `ERR_ABORTED` by URL: the same kernel/RAM URLs are the actual boot payloads, so a genuine failed worker transfer would otherwise be hidden.

## 2026-09-10 corrected recorder integration review — local-final

Status: **HARNESS HELD / ACTUAL FINAL RUN PENDING. No task verdict.** Runtime source is unchanged from the prior HELD checkpoint. The active `local-final` run was not inspected or interrupted.

Frozen identities:

```text
0d8e73791832039b5d37be606eda3aaee566c6b7defd24b96ea22b2459c92971  tools/verify/omarchy-rendering-recovery.mjs
19963d8a7afd7a0ac6fd901b61f13e73f1c68d271e7316a7c2a8b489c01d6cca  tools/verify/omarchy-rendering-recovery.test.mjs
6753151a3c3a838ad3abfd385f6bdcb54993990937466af427f8823fbf4f7572  evidence/omarchy-profile/rendering-recovery-r1/immediate/report.json
```

Independent commands:

```text
node --test tools/verify/omarchy-rendering-recovery.test.mjs
node --check tools/verify/omarchy-rendering-recovery.mjs
```

Observed: focused helper test and syntax check passed.

- **Per-phase assets — HELD.** `assertPhaseAssets` requires each of kernel, RAM, delta, and immutable base manifest to match exact URL, HTTP 200, descriptor size, and SHA-256 separately for `initial` and `reload`. Focused sabotage deletes reload RAM and corrupts reload delta; both are rejected.
- **Active SW identity — HELD.** The harness reads `VERSION`, `CACHE`, and `self.location.href` from the single actual Playwright service-worker execution, requires exact controller/registration URL agreement and the sole frozen cache version, and separately requires the served `sw.js` hash to equal the local frozen build. The stale-execution and stale-cache unit cases are rejected.
- **Worker/provenance distinction — HELD.** Actual Linux-worker Resource Timing entries establish completed requests and are explicitly labeled as not captured bodies. Independent page fetches are bounded by descriptor size and a 90-second abort, stream into an exact-size buffer, hash with WebCrypto, and are labeled contemporaneous provenance rather than worker transfers. Strict per-phase assertions consume only these provenance records.
- **Observer failures — HELD.** Inspector-unavailable records and `ERR_ABORTED` events remain in the report. A failure is accepted only when the same phase and exact URL also have an inspector limitation, full provenance match, and completed actual-worker Resource Timing entry; other failures remain fatal. Combined with real fail-closed restore/desktop-ready state, this avoids fabricating response hashes or silently disregarding failures.
- **App/source binding — HELD.** `/app` and `/app.html` are classified as source, so the document joins the existing initial/reload source, WASM, metadata, and SW identity comparison.

Fresh immediate-repaint identity is also sufficient for the narrow claim. The 05:54 report binds WASM `c48e9c2d...b9305`, kernel `af7c4e47...7cce`, manifest `5f6a0809...f23d44`, RAM `2231a21e...9235f5`, and delta `1f56d0bd...b7e7da`; it records callback count 0→1, `guestRunCalls=0`, restore decision `resume`, a real 1280x832 frame, 413 colors, 96.1489% visible pixels, and no errors. This supersedes the earlier binary-identity caveat but remains a rendering-only result.

Remaining requirement is evidence, not another source demand: the completed `local-final` report must itself pass with all provenance/worker/SW assertions and retain the real screenshots. Exact-head cold-clone and deployed-origin runs remain necessary for their respective portability and production claims. Interactive responsiveness remains explicitly outside T03c.

## 2026-09-10 independent original-pixel visual inspection

Status: **LOCAL VISUAL HELD only.** The images were opened directly with the critic's image viewer at original detail; this is not inferred from JSON or the main session's inspection. The `local-final` run was still active and had produced only its initial and 960x600 files, so portrait/large/reload below are the previously retained local run with the same held runtime identity. Final-recorder images still require inspection after they exist.

Inspected files and SHA-256:

```text
97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f  evidence/omarchy-profile/rendering-recovery-r1/local-final/desktop-initial.png
406cda33e04527d15c940507c117c9330a5e04c314deb0ce8a27c6e4559f421a  evidence/omarchy-profile/rendering-recovery-r1/local/desktop-600x900.png
4eb985843ec4c3da315e37e806eb3586bf59ce291c45f5b0f680025bda5d650a  evidence/omarchy-profile/rendering-recovery-r1/local/desktop-1920x1080.png
97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f  evidence/omarchy-profile/rendering-recovery-r1/local/desktop-reloaded.png
```

Observed directly:

- initial and reload both show a complete, nonblack Omarchy desktop: top bar, all workspace indicators, centered clock, right-side status icons, full blue-bordered Foot surface, shell prompt/cursor, and guest pointer;
- the 600x900 portrait image contains the entire 16:10 desktop centered vertically with black letterbox regions above and below; neither bar edge nor terminal border is cut off;
- the 1920x1080 image contains the entire desktop centered horizontally with side margins; the right bar icons and right Foot border are visible, refuting the earlier right-edge crop presentation;
- initial and reload are pixel-identical by SHA-256. This is valid evidence of repeat rendering consistency for the frozen visual content, not evidence of guest progress or input responsiveness.

No visual contradiction was found for black-screen recovery or CSS-contain scaling. These screenshots do not establish guest modesetting, interaction latency, or production deployment behavior.

## 2026-09-10 final observer-classification review

Status: **CLASSIFICATION HELD / PRISTINE RUN PENDING. No zero-network-error or task-verification claim.** Reviewed helper SHA-256 `8557c87eacfd59c3cc81e38f0a2a51870e82c700fb2c5864f41ce3cd74cc2d5b`; the focused test file remains `19963d8a...d6cca`. The earlier `local-final` report is retained as failed evidence (`8c7c6577...be969`) and is used only to attack the corrected predicate.

Prediction: a retained Playwright `ERR_ABORTED` may be classified only when the same phase/URL has (a) either an inspector-unavailable record or an exact captured HTTP-200 body matching the descriptor, (b) an independent full-byte provenance match, (c) an actual Linux-worker Resource Timing completion with HTTP 200, and (d) the separately asserted real restore/desktop-ready outcome.

Observation: the corrected code enforces exactly that conjunction. In the concrete initial-delta record, Playwright reported `ERR_ABORTED` while also capturing HTTP 200, 1,209,196 bytes, and SHA-256 `1f56d0bd...b7e7da`. The actual worker entry independently reports `responseStatus=200` and `encodedBodySize=1,209,196`; the phase's provenance fetch matches the same descriptor; and the initial observation has `restoredFromBootSnapshot=true` plus one desktop-ready event. The exact-body branch therefore classifies this observer contradiction honestly. Kernel/RAM inspector-eviction cases use the alternative unavailable-body branch but retain the same worker/provenance/restore requirements.

The OR does not weaken content identity: `observedExact` requires descriptor SHA and size, while explicit provenance responses are deliberately inserted into `responseHashes` without body hash/size and cannot satisfy it. Every abort remains present with a textual resolution; any non-`ERR_ABORTED`, missing completion, non-200 completion, absent provenance, wrong captured digest/size, or unknown observer failure remains fatal. `encodedBodySize` is checked against the descriptor whenever the browser exposes a nonzero value.

Independent bounded checks:

```text
node --test tools/verify/omarchy-rendering-recovery.test.mjs
node --check tools/verify/omarchy-rendering-recovery.mjs
```

Both pass. The correction is sufficient for the actual observed delta pattern and does not support a claim that no network/observer failures occurred. The pristine-clone run must still complete under this code and produce its own passed report before portability or final evidence claims advance.

## 2026-09-10 exact-head cold-clone acceptance

Status: **COLD-CLONE HELD / PRODUCTION PENDING. No task-verification or interactivity claim.** Frozen head `e05d12abe3dd7210082a2825f1ef1a679ff5bb5c`; implementation head `7c6fc874560e807d312b7d3657aadeec42356f05`. The latter-to-former change is recording-only according to the frozen receipt.

Environment/portability evidence:

```text
8cccbaecc0cb972a650b602a2413f73e6a724953edd62722b700dc6844038c69  evidence/omarchy-profile/rendering-recovery-r1/cold-clone.log
21daf425811e48c59eba2a17d58edbe13ee84cc99263364c83d2dfe890d87400  evidence/omarchy-profile/rendering-recovery-r1/frozen-head.md
70804743b8265df27d281d56215245581b0e637d68c84504e8ad8ce2254ca806  evidence/omarchy-profile/rendering-recovery-r1/cold-clone/report.json
```

The critic independently resolved `/private/tmp/wasm-vm-omarchy-render.D9yPVR/repo` to exact head `e05d12ab...bb5c`; `git status --porcelain` was empty. The receipt records `env -i` with only PATH, TMPDIR, and an isolated npm cache, no image/runtime overrides or credentials, and a fresh manifest-verified RAM download. The acceptance log records 41/41 focused tests followed by the real browser run, ending at `OMARCHY_RENDERING_PROGRESS ... "complete"` with five screenshots.

Report checks — **HELD**:

- `status="passed"`, rendering-only result, empty errors/console-errors/page-errors;
- initial and reload each restore the actual boot snapshot, emit desktop-ready, receive/present two frames at fixed 1280x800, and retain 61 colors/33,031 visible samples;
- ten full provenance records cover four declared artifacts plus worker script in both phases;
- both actual Linux workers record HTTP 200 completion for kernel, immutable base manifest, delta, and RAM; exposed encoded sizes exactly match kernel 24,208,896, delta 1,209,196, and RAM 205,050,833 bytes in both phases;
- executing SW `VERSION`/`CACHE` is `347161e9e2b8` in both phases and is bound to frozen SW SHA-256 `d16015b8...b32ad`; initial/reload source, HTML, WASM `c48e9c2d...b9305`, and metadata identities match;
- six inspector-body limitations and four `ERR_ABORTED` observations remain recorded. Each abort has the previously reviewed multi-leg resolution; this is not represented as a zero-network-error run.

The critic opened all five cold-clone PNGs directly at original detail. Digests:

```text
97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f  desktop-initial.png
c4b5bcb99dc3128579c0847289be0f164bed9bac4f835a58c34d488ee728d5c7  desktop-960x600.png
406cda33e04527d15c940507c117c9330a5e04c314deb0ce8a27c6e4559f421a  desktop-600x900.png
4eb985843ec4c3da315e37e806eb3586bf59ce291c45f5b0f680025bda5d650a  desktop-1920x1080.png
97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f  desktop-reloaded.png
```

Direct visual prediction — complete Omarchy bar and Foot surface remain visible without crop at every fitted size and after reload — **HELD**. The 960x600 image fills 16:10; portrait is centered with vertical letterboxing; 1920x1080 is centered with side margins and visibly retains both right-side bar icons and Foot border. Initial/reload are pixel-identical. No black-screen or host-scaling contradiction was found.

This discharges exact-head portability for the narrow rendering-recovery claim. The active deployment was not inspected. A deployed-origin report and direct production PNG inspection remain the final boundary; responsiveness and guest modesetting remain explicitly blocked/out of scope.

## 2026-09-10 deployed production evidence review

Status: **PRODUCTION EVIDENCE HELD / FINAL LIFECYCLE VERDICT DEFERRED.** The task file still contains the earlier worker entry stating production was outstanding and remains `in-progress`; this critic does not preempt the promised final worker claim or change status.

Evidence identities:

```text
5ae37e2ef446c05fee70216c3e85cf6d0a660413d3a6768a99cec72644165822  evidence/omarchy-profile/rendering-recovery-r1/deploy.log
a390a065a95edb1185f33223aa4903e7fca4f8d3e2df2a3bca795bfb6eb63e9e  evidence/omarchy-profile/rendering-recovery-r1/production.log
f6c0ba4064b0dc4c544471370cc1ef747b8117a9d3c9f3ac5153e75b0ca70795  evidence/omarchy-profile/rendering-recovery-r1/production/report.json
```

Deployment log records existing project `wasm-vm`, exact R2 kernel/RAM objects, exact Pages delta, 18 uploaded files, and successful deployment `https://9c404b04.wasm-vm.pages.dev`, promoted at `https://wasm-vm.pages.dev/`. No merge action is present in the reviewed deployment evidence.

The real user URL `https://wasm-vm.pages.dev/app?guest=omarchy&desktop=1#ide` passed. Report observations:

- empty errors, console errors, page errors, and request failures; six observer-body limitations remain separately recorded and do not fabricate response hashes;
- initial and same-tab reload each have real snapshot restore, one desktop-ready event, two received/two successful 1280x800 presents, 61 colors, and 33,031 visible samples;
- active execution, registration, controller, and sole cache all bind SW build `347161e9e2b8` to SHA-256 `d16015b8...b32ad` in both phases;
- initial/reload HTML, source, metadata, worker protocol, viewport code, and WASM `c48e9c2d...b9305` identities are equal;
- all ten per-phase provenance records match exact HTTP-200 descriptor bytes: kernel 24,208,896 / `af7c4e47...7cce`, RAM 205,050,833 / `2231a21e...9235f5`, delta 1,209,196 / `1f56d0bd...b7e7da`, immutable base manifest 1,097,812 / `5f6a0809...f23d44`, and worker script 1,188 / `7783b4ae...3e4b9`;
- both actual Linux workers independently report HTTP 200 completion for every boot artifact. Cross-origin encoded body sizes are unavailable as expected; exact content is supplied by the separately labeled full provenance fetches and fail-closed restore path.

The critic directly opened all five production PNGs at original detail. Their hashes exactly match the cold-clone images:

```text
97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f  desktop-initial.png
c4b5bcb99dc3128579c0847289be0f164bed9bac4f835a58c34d488ee728d5c7  desktop-960x600.png
406cda33e04527d15c940507c117c9330a5e04c314deb0ce8a27c6e4559f421a  desktop-600x900.png
4eb985843ec4c3da315e37e806eb3586bf59ce291c45f5b0f680025bda5d650a  desktop-1920x1080.png
97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f  desktop-reloaded.png
```

Direct visual prediction — production displays the complete real Omarchy bar and Foot surface initially, at all three aspect/size projections, and after reload without top-left crop or black recurrence — **HELD**. Portrait has symmetric vertical letterboxing; 1920x1080 has side margins and intact right edges; initial/reload are pixel-identical. No production rendering contradiction was found.

This production evidence satisfies the remaining deployed-origin boundary for E5.5-T03c as scoped. It does not prove responsive input, guest modeset adoption, a usable desktop, E5.5-T03a/T03d, or Epic completion. Final status remains deferred solely until the worker appends its frozen final claim for the verifier to hold against the task.
