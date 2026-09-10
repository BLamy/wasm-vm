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
