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

1. Make your guest file changes, then choose **Start recording** to save the initial point.
2. Choose **Checkpoint** for another exact restore point. **Stop recording** saves a final point and ends recording; later changes remain unsaved.
3. Select a session and restore point, then choose **Open checkpoint**. It restores CPU, RAM, device state, disk changes and pending input together, initially paused. Choose **Resume guest** to continue. Selecting a preview alone leaves the active guest in place.
4. Rename sessions to distinguish them. A reload or another tab on the same browser origin can reopen the saved points. Opening a point or starting a new checkpoint guest replaces the current guest.

**Checkpoints only.** The current library restores explicit saved points. Continuous input replay, arbitrary-time seeking, reverse-step and accelerated desktop session history are later Epic 9 boundaries. Recording cannot recover execution from before it started. A session requires its exact compatible runtime, Wasm, kernel and image; an update can leave an older named session visibly incompatible without deleting it.

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
