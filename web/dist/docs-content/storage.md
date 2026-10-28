---
kind: "Field guide"
source: "web/docs-source/guides/storage.md"
scope: "Authored explanation; verification belongs to the named evidence"
---

# Storage and persistence

A guest disk is an explicit boot input. The loader supports an initramfs, a whole disk, or a chunked disk. Persistence adds a writable local overlay to a chunked image.

## Select the storage mode

| Mode | Loader behavior | Use it for |
| --- | --- | --- |
| `initramfs` | Pass the manifest initramfs to `new WasmLinux` | Small public boot path |
| `disk` | Download the whole rootfs and use `WasmLinux.newDisk` | A complete local disk image |
| `chunked` | Fetch a manifest and retrieve disk chunks on demand | Larger image workflows |
| `chunked` with `persist: true` | Add an image-namespaced IndexedDB copy-on-write overlay | Local changes across reloads |

The default [artifact manifest](./artifacts.json) supplies the small initramfs boot path. Large Alpine disk and chunked-image workflows require their own development artifacts and local serving setup; the public page does not silently download the full Alpine root filesystem.

## Lazy chunk reads

A missing block read parks the virtio request. The host obtains the required indices through `pendingChunks()` and services them through `fetchPending()`. The chunk store verifies bytes before inserting them into its cache.

```js title="Use a local chunked image"
const controller = await startLinuxBoot({
  mode: "chunked",
  imageManifestUrl: "./releases/chunked-alpine/manifest.json",
  cacheBudgetMib: 256,
  bootProfileUrl: "./releases/chunked-alpine/boot-profile.json",
  onProgress: (role, loaded, total) => showProgress(role, loaded, total),
});
```

The boot profile is an ordered first-touch list for read-ahead, not permission to skip chunk verification. `controller.fetchStats()` exposes the selected chunked path's fetch metrics.

## Immutable base, writable overlay

Base-image chunks are verified against their manifest. The overlay records guest writes as 4 KiB blocks separately in IndexedDB, so the base remains an immutable reference. Flush ordering, recovery, image identity, and cache limits live in the detailed overlay and chunk-format contracts.

```js title="Request a persistent chunked guest"
const controller = await startLinuxBoot({
  mode: "chunked",
  persist: true,
  onWriterStatus: ({ readOnly }) => {
    console.log(readOnly ? "read-only guest" : "writer guest");
  },
});
```

The loader acquires an image-namespaced Web Lock for one writer. A competing tab boots read-only; without the Web Locks API, the persistent path also fails closed to read-only. A durable flush resolves after its IndexedDB transaction completes.

Persistence depends on browser storage availability and policy. A private browsing context, denied storage, quota pressure, or cleared site data changes the retention boundary. Treat an explicit flush and recovery proof as stronger evidence than a page saying it saved.

## Snapshots are a different boundary

A machine snapshot contains CPU, RAM, and device state. A disk overlay contains block writes. Restore must keep those boundaries coherent; a snapshot cannot substitute for a matching image manifest and overlay generation.

The loader checks build identity, image binding, and overlay generation before applying persisted resume state. Missing, incompatible, stale, foreign, or corrupt snapshots produce a typed cold-boot reason rather than silently pairing unrelated state. A snapshot is a boot optimization, not a substitute for artifact integrity.

## Local saved checkpoints

The [demo](./app.html) has a **Local saved sessions** library. Choose **New checkpoint guest** to start the pinned, single-hart Alpine software guest with 256 MiB RAM, an instruction-count clock and guest networking disabled. Boot assets are downloaded by the host. This profile keeps recording separate from the ordinary desktop's devices and live connections.

1. Make your guest file changes, then choose **Start checkpoint recording** to save the initial point.
2. Choose **Checkpoint** for another exact restore point. **Stop recording** saves a final point and ends recording; later changes remain unsaved.
3. Select a session and restore point, then choose **Open checkpoint**. It restores CPU, RAM, device state, disk changes and pending input together, initially paused. Choose **Resume guest** to continue. Selecting a preview alone leaves the active guest in place.
4. Rename sessions to distinguish them. A reload or another tab on the same browser origin can reopen the saved points. Opening a point or starting a new checkpoint guest replaces the current guest.

**Checkpoint restore.** This library restores explicit saved points. The separate **Time travel · session timeline** opens completed software recordings and admitted exact GPU histories, with seeking, reverse-step and private continuations. Older paced GPU histories remain checkpoint-only. The [time-travel guide](./docs.html?page=time-travel) covers completed recordings, branches and transfer. Full Omarchy cold-boot qualification and the original performance campaign are deferred and unproven. Recording cannot recover execution from before it started. A session requires its exact compatible runtime, Wasm, kernel and image; an update can leave an older named session visibly incompatible without deleting it.

The demo also has an **Execution boundary check**. It runs a small guest and compares exact stops, queued-event order and restored counters on the interpreter and JIT. The check reports its result in the page and runs separately from your active guest. It proves the common event-clock mechanism; the saved-session library continues to offer explicit checkpoints.

### Delivered input prefixes

Choose **Start input recording** on a ready software guest to pause it and retain an initial
witness. **Resume guest** continues capture. **Save input prefix** commits queued serial,
keyboard, pointer and host-control input in delivery order; **Stop input recording** commits
its final boundary and leaves that guest paused. Start a fresh guest to return to live use.

These rows are labelled incomplete input captures. They preserve exact bytes, frame order
and accepted/failed/cancelled upload controls, but full provider replay and Open are disabled.
Choose **Include time and random inputs** before starting to also save RTC samples, exact random bytes and their frozen instruction-clock policy. These input-prefix controls do not install the complete device and network adapters used by the separate completed-recording timeline.
Guest file-transfer capture is available through the same controller on a local SLIRP software
guest; live outbound connections, audio/microphone and accelerated guests are gated.

The **Input recording check** runs a separate small guest, compares serial and input-device
bytes that guest instructions actually read, reopens the saved prefix and checks that replay
rejects live ingress. It does not run or qualify whole-machine replay.

A failed input-prefix save pauses execution and preserves the committed prefix and pending
owned batch. Free space or raise the data limit, then choose **Save input prefix** to retry.
The recording cannot recover execution from before capture started. A guest that powers off publishes its final observations before the recording writer closes.

The **Time and entropy check** runs a separate RV64 guest with RTC reads, random fills and a timer sleep. It compares recorded and replayed machine frames, traces and guest bytes with replay providers disabled. This probe qualifies those sources; completed Linux recordings use the separate timeline.

## Local recording files

In **Time travel · session timeline**, select a finished recording and choose
**Export recording**. Import its `.wvsession` file with **Import recording file**
in another browser profile. Import selects a preview; choose **Open replay** to
restore it. Existing recording IDs are refused rather than overwritten.

The file includes the recording's required keyframes, RAM changes, historical
disk pages, recorded I/O, guest kernel and pinned VM assets. Parents and siblings
keep their own histories. Version 1 supports the installed build's completed
exact software and pure ICount/64 GPU profiles. It requires a matching installed
app for host code; it does not contain the whole website or migrate older
builds. GPU imports require compatible qualified hardware. Partial input captures
and older checkpoint-only profiles are not admitted by this archive version.

Imports check versions, digests, the complete referenced content and runtime
compatibility before publishing a playable recording. The format is uncompressed
and has no file paths: ZIP/gzip files, duplicate entries, missing content,
unsupported versions and oversized sections are rejected. It permits at most
4 GiB of object data, 640 MiB per object, 65,536 objects and an 8 MiB header;
individual manifest, log and renderer limits can be smaller. No guest instruction
runs during import, and replay does not reconnect to the original guest asset
URLs or external peers.

Known witness metadata uses canonical JSON. Duplicate inner fields or other
non-canonical encodings are refused before import publication; malformed
surviving witness metadata also stops cleanup and preserves staged data.

Recording files contain guest memory and files, typed input and network
payloads. Export/import are local operations with no automatic upload.
**Cancel local transfer** stops an unfinished transfer; a completed durable
import remains saved. A storage failure preserves other recordings and leaves
the incomplete import unavailable. **Delete local recording** removes the local
row and reclaims data that no other recording uses. Exported files stay on your
device. If a surviving recording is corrupt or uses unknown extension metadata,
cleanup reports a refusal and preserves its data for recovery.

### Limits, quota and deletion

The library reports saved binary bytes, the browser's approximate origin usage/quota and persistent-storage status. **Saved binary data limit** counts unique stored chunks once; browser metadata, caches and other site data consume additional space. **Restore points per session** limits future appends. Lowering either limit preserves existing named history.

Quota or retention failure pauses recording and the guest, preserving the last committed prefix. The status distinguishes unsaved current memory from the saved point. Free space, raise a limit or run **Clean up unreachable data**, then choose **Retry recording** to save a new point. **Stop recording** while quota-paused ends at the committed prefix. Retry refuses history that another tab changed or deleted.

**Delete selected session** asks for confirmation and removes its restore points. Shared machine chunks and disk data referenced by other sessions are preserved. Cleanup can refuse while another tab holds a writer or restore lease, or when surviving history is incomplete; the status explains the failure and lets you retry. Browser eviction or cleared data appears as incomplete history with Open disabled and Delete available.

Checkpoints are stored locally in IndexedDB on the same browser origin. Names are small display metadata in localStorage. Persistent storage can be requested, but browser denial or later site-data clearing can still remove recordings. Keep an external copy of important guest data; portable session bundle export/import belongs to the later release milestone.

{% hint style="info" %}
Passkey-encrypted user volumes belong to the proposed ProofMesh product layer. The current IndexedDB overlay is not documented as an encrypted, passkey-owned volume.
{% endhint %}

## Detailed contracts and runbooks

- [Chunked image format](./docs.html?page=reference-docs-design-chunked-image)
- [Copy-on-write overlay](./docs.html?page=reference-docs-design-cow-overlay)
- [Disk-image pipeline](./docs.html?page=reference-docs-design-image-pipeline)
- [Bounded file transfer](./docs.html?page=reference-docs-design-file-transfer)
- [Alpine rootfs build](./docs.html?page=reference-docs-rootfs)
- [Image artifacts](./docs.html?page=reference-docs-images)

### Long GPU journal recording

The **Long GPU history recording check** runs two small native test guests. It
records 4,100 queued inputs and 256 distinct immutable disk reads, publishes
intermediate checkpoints and authenticates the saved storage. This is a
recording check; full desktop playback and performance qualification remain
separate.

GPU recording keeps a maximum of 256 pending receipts and 4 MiB of pending
envelopes. Each checkpoint interval retains its 4,096-receipt and 64 MiB
admission limits. Ordinary flushes preserve those counters. Only a successfully
published checkpoint, acknowledged by the native machine, starts a new interval;
failed publication preserves the old interval and committed prefix. Callers
must capture a lawful checkpoint before the interval fills. The existing
session, retention, manifest and per-object limits still apply to the complete
saved history. Long-history reading and replay are separate qualification work.
