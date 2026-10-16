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
