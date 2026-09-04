/* @ts-self-types="./wasm_vm_wasm.d.ts" */
import { invokeJitBlock } from './snippets/wasm-vm-wasm-0a6604668439f3ad/inline0.js';
import * as import1 from "./snippets/wasm-vm-wasm-0a6604668439f3ad/inline0.js"


/**
 * Incremental SHA-256 for browser `File.stream()` inputs. The UI hashes in bounded chunks before
 * offering a WVFT upload, avoiding `File.arrayBuffer()` and its whole-file heap spike.
 */
export class FileSha256 {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FileSha256Finalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_filesha256_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    finish() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.filesha256_finish(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    constructor() {
        const ret = wasm.filesha256_new();
        this.__wbg_ptr = ret;
        FileSha256Finalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} bytes
     */
    update(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.filesha256_update(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) FileSha256.prototype[Symbol.dispose] = FileSha256.prototype.free;

/**
 * E2-T21: a browser-side unmodified-Linux boot. Unlike [`WasmMachine`] (bare-metal ELF + a
 * Uart0 stub), this assembles the full `virt` platform (CLINT/PLIC/16550/virtio/goldfish-RTC/
 * syscon/built-in SBI) via the SHARED [`Machine::place_and_boot`] and boots a kernel `Image`
 * + optional initramfs. Console is chunked: all guest output (SBI `earlycon` + the 16550
 * `ttyS0`) accumulates in a buffer that each `runChunk` flushes to a JS callback as one
 * `Uint8Array`; host keystrokes queued via `sendInput` feed the 16550 RX. The JS host drives
 * the machine off `requestAnimationFrame`/`setTimeout` (workers/SAB are Epic 4).
 */
export class WasmLinux {
    static __wrap(ptr) {
        const obj = Object.create(WasmLinux.prototype);
        obj.__wbg_ptr = ptr;
        WasmLinuxFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLinuxFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlinux_free(ptr, 0);
    }
    /**
     * Advance the overlay commit generation and return the new value. A stored snapshot taken before
     * the advance now fails the coherence guard (`"stale"`) — this is how a durable overlay commit
     * invalidates a now-inconsistent CPU/RAM snapshot.
     * @returns {number}
     */
    advanceOverlayGeneration() {
        const ret = wasm.wasmlinux_advanceOverlayGeneration(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * @param {number} slot
     * @param {string} name
     * @param {number} total
     * @param {string} sha256_hex
     * @returns {number}
     */
    beginFileUpload(slot, name, total, sha256_hex) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(sha256_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_beginFileUpload(this.__wbg_ptr, slot, ptr0, len0, total, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * E3-T03 dev-mode recorder: the ordered first-touch chunk-access list of this boot as a JSON
     * array — write it to `boot-profile.json` next to the manifest to enable boot-profile prefetch.
     * Empty `[]` for a non-chunked boot.
     * @returns {string}
     */
    bootProfile() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmlinux_bootProfile(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {number} id
     */
    cancelFileDownload(id) {
        const ret = wasm.wasmlinux_cancelFileDownload(this.__wbg_ptr, id);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} stream
     */
    cancelFileUpload(stream) {
        const ret = wasm.wasmlinux_cancelFileUpload(this.__wbg_ptr, stream);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E3-T10 (critic BUG-4): close the IndexedDB connection so a `deleteDatabase` (reset-disk)
     * can proceed instead of blocking on our open handle. Call before wiping; the machine must
     * not persist afterward. No-op off the persistent path.
     */
    closeStorage() {
        const ret = wasm.wasmlinux_closeStorage(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} id
     * @returns {boolean}
     */
    dismissFileDownload(id) {
        const ret = wasm.wasmlinux_dismissFileDownload(this.__wbg_ptr, id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {number} stream
     * @returns {boolean}
     */
    dismissFileUpload(stream) {
        const ret = wasm.wasmlinux_dismissFileUpload(this.__wbg_ptr, stream);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * E4-T29 Phase 2 (browser Linux path): attach the in-wasm JIT executor to THIS Linux guest and
     * arm tier-up. The accelerated interpreter remains the fallback for cold/untranslatable blocks;
     * the caller gates this on `crossOriginIsolated`.
     * @param {number} threshold
     */
    enableJit(threshold) {
        const ret = wasm.wasmlinux_enableJit(this.__wbg_ptr, threshold);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E4-T38: enable the Linux browser JIT under one explicit residency policy. See
     * [`WasmMachine::enable_jit_with_policy`] for the policy labels and cap semantics.
     * @param {number} threshold
     * @param {string} residency_policy
     */
    enableJitWithPolicy(threshold, residency_policy) {
        const ptr0 = passStringToWasm0(residency_policy, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_enableJitWithPolicy(this.__wbg_ptr, threshold, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E3-T02: fetch (and hash-verify) every chunk the device is parked on, populating the store so
     * the next `runChunk` completes the parked reads. Resolves to the number of chunks newly made
     * resident. No-op (0) for a non-chunked boot. Must not run concurrently with `runChunk` (both
     * borrow the machine); the JS driver alternates them.
     * @returns {Promise<number>}
     */
    fetchPending() {
        const ret = wasm.wasmlinux_fetchPending(this.__wbg_ptr);
        return ret;
    }
    /**
     * E3-T02/T03 instrumentation: `{ fetches, bytes, error, cache }` — chunk fetches + bytes
     * transferred (pass-4 acceptance), the first fetch error (or null), and the E3-T03 cache metrics
     * `{ hits, misses, evictions, residentBytes, budgetBytes }`. A non-chunked boot reports zeros.
     * @returns {any}
     */
    fetchStats() {
        const ret = wasm.wasmlinux_fetchStats(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} slot
     * @returns {boolean}
     */
    fileTransferReady(slot) {
        const ret = wasm.wasmlinux_fileTransferReady(this.__wbg_ptr, slot);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @returns {string}
     */
    fileTransferStatus() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmlinux_fileTransferStatus(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {number} id
     * @param {boolean} success
     */
    finishFileDownload(id, success) {
        const ret = wasm.wasmlinux_finishFileDownload(this.__wbg_ptr, id, success);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E4-T01: the accumulated profile as a plain JS object — `{ totalNs, sampleCount, walkCount,
     * collisions, regions: [{ pc, samples, pct }], subsystems: [{ name, ns }] }` — mirroring the
     * `getStats` surface the UI already consumes. `pc` is a hex string (a guest PC exceeds 2^53).
     * @returns {any}
     */
    getProfile() {
        const ret = wasm.wasmlinux_getProfile(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * E3-T10: whether the overlay has unpersisted (dirty) blocks. In persistent writer mode these
     * belong to a virtio WRITE that has not been acknowledged; the quota dialog uses this to say
     * Retry may still complete it, while Continue returns IOERR.
     * @returns {boolean}
     */
    hasUnpersisted() {
        const ret = wasm.wasmlinux_hasUnpersisted(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Persist an externally supplied snapshot blob (AC3 import) into the snapshot store for THIS boot's
     * base image. The blob is bound to this base's namespace; a foreign blob imported here still fails
     * the coherence guard on restore. Framing-corrupt input is replaced by a corrupt marker, and a
     * same-size payload mutation is checked against the digest of the previously published snapshot;
     * both paths make the next decision typed `"corrupt"` rather than falsely `"resume"`. The live
     * machine and overlay are not mutated. The write counter keeps lease release behind this full
     * namespace mutation. Error `"not_persistent"` off the persistent path.
     * @param {Uint8Array} blob
     * @returns {Promise<void>}
     */
    importStoredSnapshot(blob) {
        const ptr0 = passArray8ToWasm0(blob, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_importStoredSnapshot(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * E4-T29: the "JIT actually ran" proof for the browser Linux guest. Returns
     * `{hasExecutor, compiledBlocks, executedBlocks, retiredViaJit}` read straight from the installed
     * executor — `executedBlocks > 0` is the definitive evidence translated code executed (not merely
     * that `enableJit` was called). `hasExecutor:false` means no JIT is attached at all.
     * @returns {any}
     */
    jitStats() {
        const ret = wasm.wasmlinux_jitStats(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Return the latest host-owned LED state reported by the guest keyboard driver. A null
     * result means that this machine was assembled without the virtio-input keyboard capability.
     * @returns {any}
     */
    keyboardLedState() {
        const ret = wasm.wasmlinux_keyboardLedState(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Restore machine state from a resume blob (all-or-nothing; the coherence header is validated
     * FIRST). A rejected blob is mapped through [`resume::ColdBootReason`] so the JS boundary gets the
     * typed reason (`"missing"`/`"corrupt"`/`"foreign_build"`/`"foreign_image"`/`"stale"`) in the error
     * message rather than a device-internal string. NOT async (pure state application).
     * @param {Uint8Array} blob
     */
    loadSnapshotBlob(blob) {
        const ptr0 = passArray8ToWasm0(blob, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_loadSnapshotBlob(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Assemble the platform and boot. `initrd` empty = none; `bootargs` empty = the default
     * `console=ttyS0 earlycon=sbi`. `output(bytes: Uint8Array)` receives console output.
     * @param {number} ram_mib
     * @param {Uint8Array} kernel
     * @param {Uint8Array} initrd
     * @param {string} bootargs
     * @param {Function} output
     */
    constructor(ram_mib, kernel, initrd, bootargs, output) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(initrd, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(bootargs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_new(ram_mib, ptr0, len0, ptr1, len1, ptr2, len2, output);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmLinuxFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * E3-T02: boot from a CHUNKED image fetched lazily over HTTP. Instead of a full disk `Vec`, take
     * the image `manifest` JSON and the `base_url` its chunks live under (must end in `/`). A guest
     * disk read of an absent chunk parks (deferred virtio-blk completion) until `fetchPending`
     * retrieves and hash-verifies that chunk. No full-image download ever happens.
     * @param {number} ram_mib
     * @param {Uint8Array} kernel
     * @param {string} manifest_json
     * @param {string} base_url
     * @param {number} cache_budget_mib
     * @param {Uint32Array} boot_profile
     * @param {string} bootargs
     * @param {Function} output
     * @returns {WasmLinux}
     */
    static newChunkedDisk(ram_mib, kernel, manifest_json, base_url, cache_budget_mib, boot_profile, bootargs, output) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(manifest_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(base_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(boot_profile, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(bootargs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_newChunkedDisk(ram_mib, ptr0, len0, ptr1, len1, ptr2, len2, cache_budget_mib, ptr3, len3, ptr4, len4, output);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmLinux.__wrap(ret[0]);
    }
    /**
     * E3-T05: like [`Self::new_chunked_disk`], but the copy-on-write overlay is persisted to
     * IndexedDB — guest writes survive a tab reload. Async: opens the image-namespaced DB (checking
     * its recorded base binding against the manifest — a mismatch/older-version is a typed error, not
     * silent reuse), loads any previously persisted blocks, and boots over them. Call `persistPending`
     * to flush new writes durably (its Promise resolves on the IndexedDB transaction `complete`).
     * @param {number} ram_mib
     * @param {Uint8Array} kernel
     * @param {string} manifest_json
     * @param {string} base_url
     * @param {number} cache_budget_mib
     * @param {Uint32Array} boot_profile
     * @param {string} bootargs
     * @param {boolean} read_only
     * @param {Function} output
     * @param {string | null} [seed_identity]
     * @returns {Promise<WasmLinux>}
     */
    static newChunkedDiskPersistent(ram_mib, kernel, manifest_json, base_url, cache_budget_mib, boot_profile, bootargs, read_only, output, seed_identity) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(manifest_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(base_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(boot_profile, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(bootargs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        var ptr5 = isLikeNone(seed_identity) ? 0 : passStringToWasm0(seed_identity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_newChunkedDiskPersistent(ram_mib, ptr0, len0, ptr1, len1, ptr2, len2, cache_budget_mib, ptr3, len3, ptr4, len4, read_only, output, ptr5, len5);
        return ret;
    }
    /**
     * E4-T28e: boot the normal lazy Alpine root disk with one additional read-only virtio-blk
     * image. The extra image is passed by value so the fetched overlay becomes one resident Rust
     * buffer; it is never compiled or transformed on the host. The first free slot after browser
     * Linux's net/rng/keyboard/tablet/mouse reservation is used, leaving `/dev/vdb` as the second
     * block device.
     * @param {number} ram_mib
     * @param {Uint8Array} kernel
     * @param {string} manifest_json
     * @param {string} base_url
     * @param {number} cache_budget_mib
     * @param {Uint32Array} boot_profile
     * @param {Uint8Array} extra_disk
     * @param {string} bootargs
     * @param {Function} output
     * @returns {WasmLinux}
     */
    static newChunkedDiskWithExtra(ram_mib, kernel, manifest_json, base_url, cache_budget_mib, boot_profile, extra_disk, bootargs, output) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(manifest_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(base_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(boot_profile, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray8ToWasm0(extra_disk, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(bootargs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_newChunkedDiskWithExtra(ram_mib, ptr0, len0, ptr1, len1, ptr2, len2, cache_budget_mib, ptr3, len3, ptr4, len4, ptr5, len5, output);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmLinux.__wrap(ret[0]);
    }
    /**
     * E2-T26 capstone: boot from a virtio-blk DISK image (e.g. the Alpine ext4 rootfs) instead of
     * an initramfs. `disk` is MOVED into an in-memory `BlockBackend` (one wasm-side copy — the T21
     * single-copy discipline; a `&[u8]` + `.to_vec()` would double-allocate 512 MB). Default
     * bootargs mount `/dev/vda` as root.
     * @param {number} ram_mib
     * @param {Uint8Array} kernel
     * @param {Uint8Array} disk
     * @param {string} bootargs
     * @param {Function} output
     * @returns {WasmLinux}
     */
    static newDisk(ram_mib, kernel, disk, bootargs, output) {
        const ptr0 = passArray8ToWasm0(kernel, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(disk, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(bootargs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_newDisk(ram_mib, ptr0, len0, ptr1, len1, ptr2, len2, output);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmLinux.__wrap(ret[0]);
    }
    /**
     * E3-T21d: the persistent driver calls this right after `persistPending` so a durable IndexedDB
     * flush pause — during which the guest is frozen and cannot ACK or heartbeat an in-flight file
     * transfer — does not accrue against the WVFT idle-timeout budget. No-op when nothing is
     * transferring or off the slirp path.
     */
    noteFileTransferPersist() {
        const ret = wasm.wasmlinux_noteFileTransferPersist(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * The current overlay commit generation (the snapshot coherence's third binding). `u64` fits
     * exactly in an `f64` for every realistic generation count.
     * @returns {number}
     */
    overlayGeneration() {
        const ret = wasm.wasmlinux_overlayGeneration(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * E3-T02: the chunk indices the virtio-blk device is currently parked on (guest reads awaiting a
     * lazy fetch). Empty for a non-chunked boot or when nothing is parked. The JS driver calls this
     * after each `runChunk` and, if non-empty, awaits `fetchPending` before the next `runChunk`.
     * @returns {Uint32Array}
     */
    pendingChunks() {
        const ret = wasm.wasmlinux_pendingChunks(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * E3-T05: durably flush the overlay's pending writes to IndexedDB. Resolves to the number of
     * blocks persisted; its Promise resolves only after the IndexedDB transaction `complete` event
     * (`durability` per the store), so a caller that awaits it knows the writes survive a reload. A
     * block re-written during the flush is NOT marked persisted (generation guard) and is flushed
     * next call — never lost. No-op (0) for a non-persistent boot. Must not run concurrently with
     * `runChunk` (both borrow the machine); the JS driver alternates them.
     * @returns {Promise<number>}
     */
    persistPending() {
        const ret = wasm.wasmlinux_persistPending(this.__wbg_ptr);
        return ret;
    }
    /**
     * Convenience: take a resume snapshot AND durably persist it to the snapshot IndexedDB store in one
     * call. The `RefCell` borrow is scoped to `save_resume` + reading `snapshot_base`; the store I/O
     * runs after it is dropped, never across the borrow. The write counter keeps a lease release
     * from handing the namespace to another tab until this async operation has committed. No-op
     * error `"not_persistent"` off the persistent path (there is no snapshot store to write to).
     * @returns {Promise<void>}
     */
    persistSnapshot() {
        const ret = wasm.wasmlinux_persistSnapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * E3-T08/E3-T10 persistence pressure —
     * `{ pendingBlocks, pendingBytes, flushWaiting, writeWaiting }`. The JS pump persists
     * immediately when a guest WRITE or FLUSH is parked awaiting durable commit; pending bytes
     * over the configured threshold remain the generic write-back backpressure signal. Zeros for
     * non-persistent boots.
     * @returns {any}
     */
    persistStats() {
        const ret = wasm.wasmlinux_persistStats(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} stream
     * @param {Uint8Array} bytes
     * @param {boolean} finished
     * @returns {number}
     */
    pushFileUpload(stream, bytes, finished) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_pushFileUpload(this.__wbg_ptr, stream, ptr0, len0, finished);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Read the persisted snapshot blob back (reassembled), or `null` if none is stored / not on the
     * persistent path. Async (IndexedDB). This is the export/debug surface; production restore uses
     * [`Self::restore_stored_snapshot`] so the blob never crosses the wasm/JS boundary as a second
     * whole-payload copy.
     * @returns {Promise<any>}
     */
    readStoredSnapshot() {
        const ret = wasm.wasmlinux_readStoredSnapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * Permanently relinquish this machine's snapshot-writer role. Web Locks releases are dynamic:
     * another tab may acquire the same namespace while this controller is still alive, so the
     * construction-time read-only bit alone is not a sufficient fence for a stale controller. New
     * writes are fenced immediately, while writes that already passed the check are allowed to
     * finish before this method resolves. There is intentionally no inverse operation; a new
     * machine must acquire the writer lock before it can save or import snapshots.
     * @returns {Promise<void>}
     */
    relinquishSnapshotWriter() {
        const ret = wasm.wasmlinux_relinquishSnapshotWriter(this.__wbg_ptr);
        return ret;
    }
    /**
     * The header-level resume-vs-cold-boot verdict for `stored` (the reassembled blob, or `None`),
     * against THIS boot's build identity + base binding + `current_generation`. Returns the stable
     * code (`"resume"`/`"missing"`/`"corrupt"`/`"foreign_build"`/`"foreign_image"`/`"stale"`). Off the
     * persistent path (no base binding) there is no snapshot to resume: always `"missing"`.
     * @param {Uint8Array | null | undefined} stored
     * @param {number} current_generation
     * @returns {string}
     */
    restoreDecisionCode(stored, current_generation) {
        let deferred3_0;
        let deferred3_1;
        try {
            var ptr0 = isLikeNone(stored) ? 0 : passArray8ToWasm0(stored, wasm.__wbindgen_malloc);
            var len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmlinux_restoreDecisionCode(this.__wbg_ptr, ptr0, len0, current_generation);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Load and, only when coherent, apply the persisted snapshot directly inside wasm. The stored
     * blob is held by one Rust allocation while the coherence header is checked and the machine is
     * restored; unlike `readStoredSnapshot` this path does not create a JS `Uint8Array` boundary copy.
     * Returns the same typed decision code as `restoreDecisionCode`, with no machine mutation for a
     * missing, corrupt, foreign, or stale snapshot.
     * @returns {Promise<string>}
     */
    restoreStoredSnapshot() {
        const ret = wasm.wasmlinux_restoreStoredSnapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * Run up to `max_instrs`, drain console output to the JS callback, feed queued input to the
     * 16550 RX, and return `{ done: bool, state: string|null, retired: number }`. A persistent caller may pass
     * `persist_max_dirty_bytes`; execution then yields as soon as the write-back queue reaches
     * that limit so JS can durably drain it before the guest can race arbitrarily far ahead.
     * `state` is `"poweroff"`, `"reboot"`, `"fail:<code>"`, `"exited:<code>"`, or
     * `"trap:<cause>"` once terminal.
     * @param {number} max_instrs
     * @param {number | null} [persist_max_dirty_bytes]
     * @returns {any}
     */
    runChunk(max_instrs, persist_max_dirty_bytes) {
        const ret = wasm.wasmlinux_runChunk(this.__wbg_ptr, max_instrs, isLikeNone(persist_max_dirty_bytes) ? Number.MAX_SAFE_INTEGER : (persist_max_dirty_bytes) >>> 0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Take a whole-machine resume snapshot and return its bytes as a `Uint8Array`. NOT async and NOT
     * persisting — kept synchronous so the `RefCell` borrow is never held across an `await` (the JS
     * caller may drive persistence itself, or use [`Self::persist_snapshot`]). `save_resume` quiesces
     * virtio-blk first; if the in-flight set cannot drain, the error message starts with
     * `"not_quiesced"` so the caller can retry rather than treat it as a hard failure; any other error
     * starts with `"save_error"`.
     * @returns {any}
     */
    saveSnapshot() {
        const ret = wasm.wasmlinux_saveSnapshot(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Queue host keystrokes for the guest's `ttyS0` (fed to the RX FIFO across `runChunk`s).
     * @param {Uint8Array} bytes
     */
    sendInput(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_sendInput(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Queue one guest-visible evdev keyboard event. Call `syncKeyboard` after the host's
     * keydown/keyup event (or after a batch of related events) to publish the frame with its
     * `SYN_REPORT`; browser repeat events must not call this method as key-downs.
     * @param {number} event_type
     * @param {number} code
     * @param {number} value
     */
    sendKeyboardEvent(event_type, code, value) {
        const ret = wasm.wasmlinux_sendKeyboardEvent(this.__wbg_ptr, event_type, code, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Queue one guest-visible relative-mouse event. Call `syncMouse` after the complete DOM
     * pointer frame so the guest receives exactly one `EV_SYN/SYN_REPORT` terminator.
     * @param {number} event_type
     * @param {number} code
     * @param {number} value
     */
    sendMouseEvent(event_type, code, value) {
        const ret = wasm.wasmlinux_sendMouseEvent(this.__wbg_ptr, event_type, code, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Queue one guest-visible absolute-tablet event. Call `syncTablet` after the complete DOM
     * pointer frame so the guest receives exactly one `EV_SYN/SYN_REPORT` terminator.
     * @param {number} event_type
     * @param {number} code
     * @param {number} value
     */
    sendTabletEvent(event_type, code, value) {
        const ret = wasm.wasmlinux_sendTabletEvent(this.__wbg_ptr, event_type, code, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E4-T39: toggle static region chaining without rebuilding the generated modules.
     * @param {boolean} on
     */
    setChaining(on) {
        const ret = wasm.wasmlinux_setChaining(this.__wbg_ptr, on);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E3-T10: flip the disk to read-only at runtime — the "continue read-only" choice after a
     * storage-quota hit. Subsequent guest writes get EIO (VIRTIO_BLK_F_RO / BlockError::ReadOnly)
     * so the guest sees an honest I/O error instead of a silently-undurable write. No-op off the
     * persistent path. Returns true if a disk flag was flipped.
     * @returns {boolean}
     */
    setDiskReadOnly() {
        const ret = wasm.wasmlinux_setDiskReadOnly(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * E4-T39: toggle generated dynamic-return (`jalr`) chaining independently of static regions.
     * @param {boolean} on
     */
    setDynamicChaining(on) {
        const ret = wasm.wasmlinux_setDynamicChaining(this.__wbg_ptr, on);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E4-T30: select the production interpreter fast path for a browser Linux guest. It combines
     * physical-entry predecode reuse with the proven <=128-retire interrupt/device batching. The
     * caller can turn it off for a byte-identical legacy A/B; enabling JIT later turns it back on
     * because the compiled tier consumes the same block-discovery front end.
     * @param {boolean} on
     */
    setFastInterpreter(on) {
        const ret = wasm.wasmlinux_setFastInterpreter(this.__wbg_ptr, on);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} ready
     */
    setFileDownloadReady(ready) {
        const ret = wasm.wasmlinux_setFileDownloadReady(this.__wbg_ptr, ready);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E4-T01: arm/disarm the hot-PC + subsystem-time profiler for this boot. Arming injects a
     * `performance.now()`-backed [`JsHostTimer`]; sampling is 1-in-~1024 retires + cold-path-only
     * timing (~0 overhead). Returns `false` if no `performance` object is available to arm it.
     * @param {boolean} on
     * @returns {boolean}
     */
    setProfiling(on) {
        const ret = wasm.wasmlinux_setProfiling(this.__wbg_ptr, on);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * E4 restore-on-first-load (busybox boot-snapshot): stamp THIS machine's coherence identity so a
     * shipped, build-time boot snapshot can be restored on the initramfs path (which otherwise sets no
     * snapshot identity — `snapshot_base` stays `None` and every restore verdict is `"missing"`).
     *
     * The core identity is [`build_core_hash`] (the crate version), so a snapshot produced by a
     * DIFFERENT build fails the `CoreHashMismatch` guard and the caller falls back to a cold boot —
     * the guard is bound, never bypassed. `base_id` (32 bytes) binds the snapshot to a specific
     * kernel+initramfs pair (the JS caller derives it from the boot manifest's artifact hashes); a
     * snapshot for a different kernel/initramfs fails `BaseImageMismatch`. Overlay generation stays 0
     * (the initramfs path has no durable overlay to invalidate against).
     * @param {Uint8Array} base_id
     */
    stampBootSnapshotIdentity(base_id) {
        const ptr0 = passArray8ToWasm0(base_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinux_stampBootSnapshotIdentity(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Final/current guest-RAM SHA-256 for browser evidence. This is the `mem_digest` portion of the
     * native snapshot contract; registers and device state are intentionally not encoded here.
     * @returns {string}
     */
    stateDigest() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmlinux_stateDigest(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Publish the current host keyboard frame by appending `EV_SYN/SYN_REPORT`.
     */
    syncKeyboard() {
        const ret = wasm.wasmlinux_syncKeyboard(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Publish the current host relative-mouse frame with `EV_SYN/SYN_REPORT`.
     */
    syncMouse() {
        const ret = wasm.wasmlinux_syncMouse(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Publish the current host absolute-tablet frame with `EV_SYN/SYN_REPORT`.
     */
    syncTablet() {
        const ret = wasm.wasmlinux_syncTablet(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} id
     * @returns {Uint8Array}
     */
    takeFileDownloadChunk(id) {
        const ret = wasm.wasmlinux_takeFileDownloadChunk(this.__wbg_ptr, id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmLinux.prototype[Symbol.dispose] = WasmLinux.prototype.free;

/**
 * JS-facing handle over [`wasm_vm_core::Machine`].
 */
export class WasmMachine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMachineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmachine_free(ptr, 0);
    }
    /**
     * E4-T29 Phase 2: attach the in-wasm (browser) JIT executor to this machine and arm tier-up.
     * Mirrors the native CLI `--jit` wiring (constructs the executor, calls `set_executor`, turns on
     * the block cache + interrupt batching + hotness discovery) so a booted browser guest executes
     * translated blocks. The interpreter stays the oracle: with the JIT off (this never called) the
     * run loop is byte-identical to the pre-T29 path. `threshold` is the hotness count before a block
     * is nominated for compilation (1 = eager, for tests). The caller is responsible for gating this
     * on `crossOriginIsolated` (E4-T22 `selectJitBackend`) — see `web/cpu-isolation.js`.
     * @param {number} threshold
     */
    enableJit(threshold) {
        const ret = wasm.wasmmachine_enableJit(this.__wbg_ptr, threshold);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E4-T38: attach the browser JIT with one explicit residency screen. `repack-off` is the
     * current single-pass batcher with the conservative 24-module browser cap; `cap-256` and
     * `cap-1024` retain the same translator and eviction policy while changing only the live-batch
     * cap. Validate and apply the policy before publishing the executor so a bad benchmark label
     * cannot leave a partially initialized machine.
     * @param {number} threshold
     * @param {string} residency_policy
     */
    enableJitWithPolicy(threshold, residency_policy) {
        const ptr0 = passStringToWasm0(residency_policy, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmachine_enableJitWithPolicy(this.__wbg_ptr, threshold, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E2-T20: the interrupt/trap counters + storm/WFI diagnosis as a JS object
     * `{ retired, wfi, exceptions:[16], interrupts:[16], claims:[32], storm:bool, wfiReport:string|null }`.
     * E2-T26's UI surfaces these so a browser boot that death-spirals shows a diagnosis instead
     * of a silently-pinned tab.
     * @returns {any}
     */
    getStats() {
        const ret = wasm.wasmmachine_getStats(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * E4-T31: the bare-metal wrapper's authoritative compiled-tier counters. This mirrors the
     * Linux wrapper and lets hosts distinguish a bounded JIT run from an interpreted trace run.
     * @returns {any}
     */
    jitStats() {
        const ret = wasm.wasmmachine_jitStats(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Load a bare-metal rv64 ELF. A malformed image throws a `JsError` naming the
     * `ElfError` variant and leaves the machine usable (RAM is validated before it is
     * written).
     * @param {Uint8Array} bytes
     */
    loadElf(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmachine_loadElf(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Construct a machine with `ram_mib` MiB of zeroed guest RAM and a UART0 console
     * wired to a (initially unset) JS callback. A `ram_mib` too large to allocate throws
     * a catchable `JsError` — never a wasm `unreachable` abort that would poison the
     * module (the allocation goes through `try_reserve_exact`).
     * @param {number} ram_mib
     */
    constructor(ram_mib) {
        const ret = wasm.wasmmachine_new(ram_mib);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmMachineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Size of guest RAM in bytes.
     * @returns {number}
     */
    ramLen() {
        const ret = wasm.wasmmachine_ramLen(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * The 33 architectural registers as a `BigUint64Array`: `[pc, x0, x1, …, x31]`.
     * @returns {BigUint64Array}
     */
    registers() {
        const ret = wasm.wasmmachine_registers(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Run up to `max_instrs` instructions, returning a status object:
     * `{ kind: "exited"|"trapped"|"max", code?, cause?, tval?, retired }`.
     * @param {number} max_instrs
     * @returns {any}
     */
    run(max_instrs) {
        const ret = wasm.wasmmachine_run(this.__wbg_ptr, max_instrs);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * E4-T39: toggle static region chaining without rebuilding the generated modules.
     * @param {boolean} on
     */
    setChaining(on) {
        const ret = wasm.wasmmachine_setChaining(this.__wbg_ptr, on);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Install (or replace) the per-byte console callback: `fn(byte: number)`.
     * @param {Function} cb
     */
    setConsole(cb) {
        const ret = wasm.wasmmachine_setConsole(this.__wbg_ptr, cb);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * E4-T39: toggle generated dynamic-return (`jalr`) chaining independently of static regions.
     * @param {boolean} on
     */
    setDynamicChaining(on) {
        const ret = wasm.wasmmachine_setDynamicChaining(this.__wbg_ptr, on);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Enable or disable canonical instruction tracing (appended to an internal buffer;
     * drain it with `takeTrace`).
     * @param {boolean} on
     */
    setTrace(on) {
        const ret = wasm.wasmmachine_setTrace(this.__wbg_ptr, on);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * SHA-256 of guest RAM as 64 lowercase hex chars (matches the CLI `--dump-state`).
     * @returns {string}
     */
    stateDigest() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmmachine_stateDigest(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Step up to `n` instructions, returning how many retired. Same engine as `run`
     * (HTIF is consulted), but the caller reads a plain count instead of a status object.
     * @param {number} n
     * @returns {number}
     */
    step(n) {
        const ret = wasm.wasmmachine_step(this.__wbg_ptr, n);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Take and clear the accumulated canonical trace.
     * @returns {string}
     */
    takeTrace() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmmachine_takeTrace(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) WasmMachine.prototype[Symbol.dispose] = WasmMachine.prototype.free;

/**
 * Instructions-per-second baseline (E0-T24), node + browser side. Runs `loops.elf` on the
 * trace-off (`run`) path repeatedly until at least `target_instrs` instructions have
 * retired (`≥ 10^7` keeps JS↔wasm boundary chatter out of the measurement), and returns a
 * `{ retired, ms }` object timed with `Date.now()`. MIPS = `retired / ms / 1000`. Each run
 * retires exactly the golden count (a reload is a clean reset), so `retired` is exact.
 * @param {number} target_instrs
 * @returns {any}
 */
export function bench(target_instrs) {
    const ret = wasm.bench(target_instrs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

export function initLogging() {
    wasm.initLogging();
}

/**
 * E3-T10: the IndexedDB database name that holds a given image's durable overlay — so the
 * "reset disk" flow can `indexedDB.deleteDatabase(name)` for THIS image only (a second image's
 * overlay, in a different DB, survives). Same derivation the durable store uses
 * (`overlay_store_name(base_hash)` for legacy boots, or the exact shipped RAM+delta pair's
 * independent seed namespace), so it always matches. Omitting `seed_identity` preserves the
 * legacy name.
 * @param {string} manifest_json
 * @param {string | null} [seed_identity]
 * @returns {string}
 */
export function overlayDbName(manifest_json, seed_identity) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(manifest_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(seed_identity) ? 0 : passStringToWasm0(seed_identity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.overlayDbName(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * E4 Alpine restore-on-load: seed the IndexedDB copy-on-write overlay for this chunked image with the
 * shipped `WVOD1` overlay-delta (the ~1 MB set of post-boot-dirtied 4 KiB blocks) BEFORE constructing
 * the persistent machine, so a subsequent [`WasmLinux::new_chunked_disk_persistent`]'s `load_blocks()`
 * picks them up and the restored guest's cache-miss disk reads return the *post-boot* block content.
 *
 * Coherence is bound, not bypassed:
 * * the delta's `base_binding`/`image_len` must match this manifest's `base_hash`/`image_len`
 *   (`delta_base_mismatch` otherwise) — a delta for a different chunked base is rejected;
 * * a brand-new (no meta, no blocks) store is seeded, while an existing store is accepted only when
 *   its valid meta and complete block-index/value set exactly equal the delta. Any changed, added, or
 *   removed user block is left untouched and returns `false`, forcing the paired RAM snapshot to be
 *   skipped and the normal cold boot to continue over that existing overlay.
 *
 * Returns `true` iff the delta was freshly seeded or the existing overlay is byte-exact, `false` for
 * any other existing state. Returning `false` never writes to the store.
 * The paired RAM snapshot rides the same overlay generation (0 for a fresh store); the restore's
 * `restoreDecisionCode` guard enforces the core-hash + base + generation triple before `loadSnapshotBlob`.
 * @param {string} manifest_json
 * @param {Uint8Array} delta_bytes
 * @param {string | null} [seed_identity]
 * @returns {Promise<boolean>}
 */
export function seedOverlayDelta(manifest_json, delta_bytes, seed_identity) {
    const ptr0 = passStringToWasm0(manifest_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(delta_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(seed_identity) ? 0 : passStringToWasm0(seed_identity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.seedOverlayDelta(ptr0, len0, ptr1, len1, ptr2, len2);
    return ret;
}

/**
 * Configure the DHCP lease duration for subsequent boots (used by the renewal acceptance).
 * @param {number} seconds
 */
export function setSlirpDhcpLeaseSeconds(seconds) {
    wasm.setSlirpDhcpLeaseSeconds(seconds);
}

/**
 * Configure the RFC 8484 wire-format DoH endpoint. Empty restores the production default.
 * @param {string} endpoint
 */
export function setSlirpDohEndpoint(endpoint) {
    const ptr0 = passStringToWasm0(endpoint, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.setSlirpDohEndpoint(ptr0, len0);
}

/**
 * Configure the DHCP-advertised link MTU for subsequent boots.
 * @param {number} mtu
 */
export function setSlirpMtu(mtu) {
    wasm.setSlirpMtu(mtu);
}

/**
 * Choose the slirp local network stack (vs the default loopback) for subsequent boots.
 * @param {boolean} on
 */
export function setSlirpNet(on) {
    wasm.setSlirpNet(on);
}

/**
 * Configure the WebSocket relay used for outbound TCP on subsequent slirp boots. An empty URL
 * keeps the local-only DHCP/ARP/ICMP stack.
 * @param {string} url
 */
export function setSlirpRelay(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.setSlirpRelay(ptr0, len0);
}

/**
 * Stage a short-lived relay credential for exactly the next boot. It is kept out of URLs and
 * consumed when the connector is constructed, so a later boot cannot silently replay it.
 * @param {string} token
 */
export function setSlirpRelayToken(token) {
    const ptr0 = passStringToWasm0(token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.setSlirpRelayToken(ptr0, len0);
}

/**
 * Configure the dedicated Tailscale provider Worker for the next slirp boot. The structured
 * config is consumed when the Worker starts; credentials are never placed in the Worker URL.
 * Empty `url` selects no Tailscale provider and drops any previously staged config.
 * @param {string} url
 * @param {any} config
 */
export function setSlirpTailscaleWorker(url, config) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.setSlirpTailscaleWorker(ptr0, len0, config);
}

/**
 * Snapshot the current boot's production DHCP exchanges for evidence and diagnostics.
 * @returns {string}
 */
export function slirpDhcpStats() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.slirpDhcpStats();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Send a credential-free lifecycle command to the active provider Worker. Returns false when
 * no Tailscale provider owns this boot (relay/offline selection never creates a Worker).
 * @param {string} command
 * @returns {boolean}
 */
export function slirpTailscaleCommand(command) {
    const ptr0 = passStringToWasm0(command, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.slirpTailscaleCommand(ptr0, len0);
    return ret !== 0;
}

/**
 * The core crate version, exposed to JS.
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_c25d447a39f5578f: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_ea9085d691f535d3: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_a27215656b807791: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_memory_de265df8aadd6273: function() {
            const ret = wasm.memory;
            return ret;
        },
        __wbg___wbindgen_number_get_394265ed1e1b84ee: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_b0ca35b86a603356: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_fffb441def202758: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_abort_8bae0f33e7833997: function(arg0) {
            arg0.abort();
        },
        __wbg_apply_23dd4d2439189415: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.apply(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_arrayBuffer_3b637f0fa65c5351: function() { return handleError(function (arg0) {
            const ret = arg0.arrayBuffer();
            return ret;
        }, arguments); },
        __wbg_buffer_0f212447ac64c53b: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_byteLength_41862ca4020b9c43: function(arg0) {
            const ret = arg0.byteLength;
            return ret;
        },
        __wbg_call_8a2dd23819f8a60a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_call_a6e5c5dce5018821: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_e3b662382210db98: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_clear_772d79d5d3e7307a: function() { return handleError(function (arg0) {
            const ret = arg0.clear();
            return ret;
        }, arguments); },
        __wbg_close_4c3686e8e8c6d353: function(arg0) {
            arg0.close();
        },
        __wbg_close_c65ca0257e895318: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_count_4b5216babe494538: function() { return handleError(function (arg0) {
            const ret = arg0.count();
            return ret;
        }, arguments); },
        __wbg_createObjectStore_ff668af6e79f0433: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.createObjectStore(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_data_328de4280640da92: function(arg0) {
            const ret = arg0.data;
            return ret;
        },
        __wbg_debug_87fd9b1a625b7efb: function(arg0) {
            console.debug(arg0);
        },
        __wbg_error_5b02424faf301d7c: function(arg0) {
            const ret = arg0.error;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_error_744744ff0c9861e6: function(arg0) {
            console.error(arg0);
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_error_becd7e1fe6ce0623: function() { return handleError(function (arg0) {
            const ret = arg0.error;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_exports_085d8a69333b42bc: function(arg0) {
            const ret = arg0.exports;
            return ret;
        },
        __wbg_fetch_6ecc661950e58d49: function(arg0, arg1) {
            const ret = arg0.fetch(arg1);
            return ret;
        },
        __wbg_fetch_b5951fc96f52f786: function(arg0, arg1) {
            const ret = arg0.fetch(arg1);
            return ret;
        },
        __wbg_from_13e323c65fc8f464: function(arg0) {
            const ret = Array.from(arg0);
            return ret;
        },
        __wbg_getAllKeys_600fd10abc7076d8: function() { return handleError(function (arg0) {
            const ret = arg0.getAllKeys();
            return ret;
        }, arguments); },
        __wbg_getAll_b31fdebb43579f13: function() { return handleError(function (arg0) {
            const ret = arg0.getAll();
            return ret;
        }, arguments); },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_get_507a50627bffa49b: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_78f252d074a84d0b: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_cefddcaffca4fbb7: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.get(arg1);
            return ret;
        }, arguments); },
        __wbg_get_unchecked_6e0ad6d2a41b06f6: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_grow_921bb12f163cfe6c: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.grow(arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_headers_7b59c5203c8c475d: function(arg0) {
            const ret = arg0.headers;
            return ret;
        },
        __wbg_indexedDB_594b9e6820e78c00: function() { return handleError(function (arg0) {
            const ret = arg0.indexedDB;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_indexedDB_c7dd741e3b661da5: function() { return handleError(function (arg0) {
            const ret = arg0.indexedDB;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_info_eadbe775a8e2e9eb: function(arg0) {
            console.info(arg0);
        },
        __wbg_instanceof_ArrayBuffer_4480b9e0068a8adb: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_IdbDatabase_1cc734ba1b040dd7: function(arg0) {
            let result;
            try {
                result = arg0 instanceof IDBDatabase;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_IdbOpenDbRequest_c34a5f3bfadf1d88: function(arg0) {
            let result;
            try {
                result = arg0 instanceof IDBOpenDBRequest;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_IdbTransaction_cd93f627db2edaa5: function(arg0) {
            let result;
            try {
                result = arg0 instanceof IDBTransaction;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Memory_2550e651acb3f2f1: function(arg0) {
            let result;
            try {
                result = arg0 instanceof WebAssembly.Memory;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Response_c8b64b2256f01bec: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Response;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_309b927aaf7a3fc7: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Window_05ba1ee4f6781663: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_WorkerGlobalScope_8ec07b5e040a41c3: function(arg0) {
            let result;
            try {
                result = arg0 instanceof WorkerGlobalScope;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_invokeJitBlock_99121dda606f7308: function(arg0, arg1, arg2) {
            const ret = invokeJitBlock(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_370319915dc99107: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_81804e6c5f144937: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_log_d267660666346fb3: function(arg0) {
            console.log(arg0);
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_name_9d2bcd24d4433cef: function(arg0, arg1) {
            const ret = arg1.name;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_new_0dc07b435d476dbd: function() { return handleError(function (arg0) {
            const ret = new WebAssembly.Table(arg0);
            return ret;
        }, arguments); },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_32b398fb48b6d94a: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_4339b2a2675a03e3: function() { return handleError(function () {
            const ret = new AbortController();
            return ret;
        }, arguments); },
        __wbg_new_711fb31c64c1c363: function() { return handleError(function (arg0) {
            const ret = new WebAssembly.Module(arg0);
            return ret;
        }, arguments); },
        __wbg_new_944c2b5ed6653041: function() { return handleError(function (arg0, arg1) {
            const ret = new WebAssembly.Instance(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_new_aec3e25493d729fe: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h8c3f0668a05de02f(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_bf8729ffe10e9ee7: function() { return handleError(function (arg0, arg1) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_cd45aabdf6073e84: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_da52cf8fe3429cb2: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_77cdfb7977362f3c: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_1824d93f294193e5: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h8c3f0668a05de02f(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_byte_offset_and_length_54c7724ee3ec7d82: function(arg0, arg1, arg2) {
            const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_new_with_length_3709f79f83165acf: function(arg0) {
            const ret = new BigUint64Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_e6785c33c8e4cce8: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_options_6b48999e016c6fc6: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Worker(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_with_str_and_init_d95cbe11ce28e65e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_now_390768da5ee9e776: function(arg0) {
            const ret = arg0.now();
            return ret;
        },
        __wbg_now_86c0d4ba3fa605b8: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_objectStore_d5f47956b6c741e3: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.objectStore(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_of_5f1b88183ddb5d94: function(arg0, arg1) {
            const ret = Array.of(arg0, arg1);
            return ret;
        },
        __wbg_of_b0cd2e09b31a9684: function(arg0, arg1, arg2) {
            const ret = Array.of(arg0, arg1, arg2);
            return ret;
        },
        __wbg_open_72e5234a49d5f85d: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.open(getStringFromWasm0(arg1, arg2), arg3 >>> 0);
            return ret;
        }, arguments); },
        __wbg_performance_3ef602e13d6c3b56: function(arg0) {
            const ret = arg0.performance;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_performance_4b767c567e1a406b: function(arg0) {
            const ret = arg0.performance;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_postMessage_56396682c54d5757: function() { return handleError(function (arg0, arg1) {
            arg0.postMessage(arg1);
        }, arguments); },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_d2ae3af0c1217ae6: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_put_a368805e3dcab3a7: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.put(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_queueMicrotask_0ab5b2d2393e99b9: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_6a09b7bc46549209: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_readyState_50bc38c2a9e83db6: function(arg0) {
            const ret = arg0.readyState;
            return ret;
        },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_resolve_2191a4dfe481c25b: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_result_2b1294a2bf8dc773: function() { return handleError(function (arg0) {
            const ret = arg0.result;
            return ret;
        }, arguments); },
        __wbg_send_a321b376d40ec867: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.send(getArrayU8FromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_setTimeout_6928223bf8fbd91a: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.setTimeout(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_setTimeout_cfa2cf195c3738db: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.setTimeout(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_0de9c62c23d04ad5: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.set(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_set_4d7dd76f3dae2926: function(arg0, arg1, arg2) {
            arg0.set(getArrayU8FromWasm0(arg1, arg2));
        },
        __wbg_set_5d8eaa6b2caf4444: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.set(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_set_61e45ae8061eca11: function(arg0, arg1, arg2) {
            arg0.set(arg1, arg2 >>> 0);
        },
        __wbg_set_8535240470bf2500: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_binaryType_a37b086c78ca7c29: function(arg0, arg1) {
            arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
        },
        __wbg_set_body_029f2d171e0a005f: function(arg0, arg1) {
            arg0.body = arg1;
        },
        __wbg_set_eeaf6f49bd2bf077: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.set(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_set_index_c0ab70cbaf022bbb: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = BigInt.asUintN(64, arg2);
        },
        __wbg_set_method_5532d59b92d76467: function(arg0, arg1, arg2) {
            arg0.method = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_name_9ee85c4227217134: function(arg0, arg1, arg2) {
            arg0.name = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_onabort_e8ad31807de2db24: function(arg0, arg1) {
            arg0.onabort = arg1;
        },
        __wbg_set_onclose_f706475385ecce07: function(arg0, arg1) {
            arg0.onclose = arg1;
        },
        __wbg_set_oncomplete_e6abb66d0ad42731: function(arg0, arg1) {
            arg0.oncomplete = arg1;
        },
        __wbg_set_onerror_3488a474171ed56d: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onerror_9f5773fd31512333: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onerror_cc3a477eed014488: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onerror_f8d31be44335c633: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onmessage_57d6a01ac0bfd3a3: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onmessage_836d2f72130b4706: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onopen_4f65470ae522a61a: function(arg0, arg1) {
            arg0.onopen = arg1;
        },
        __wbg_set_onsuccess_cd0c3642a2873e66: function(arg0, arg1) {
            arg0.onsuccess = arg1;
        },
        __wbg_set_onupgradeneeded_7b2cf4ba1c57e655: function(arg0, arg1) {
            arg0.onupgradeneeded = arg1;
        },
        __wbg_set_onversionchange_c4d25c90ac386854: function(arg0, arg1) {
            arg0.onversionchange = arg1;
        },
        __wbg_set_signal_c4ef8faddb4c1446: function(arg0, arg1) {
            arg0.signal = arg1;
        },
        __wbg_set_type_e30b9a6650be2f07: function(arg0, arg1) {
            arg0.type = __wbindgen_enum_WorkerType[arg1];
        },
        __wbg_signal_dad7cb35193abd31: function(arg0) {
            const ret = arg0.signal;
            return ret;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_146583524fe1469b: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_status_c45b3b9b3033184a: function(arg0) {
            const ret = arg0.status;
            return ret;
        },
        __wbg_subarray_3ed232c8a6baee09: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_target_e759594a8d965ed7: function(arg0) {
            const ret = arg0.target;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_terminate_13d19661bbbf7d2b: function(arg0) {
            arg0.terminate();
        },
        __wbg_then_16d107c451e9905d: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_6ec10ae38b3e92f7: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_transaction_a00de84491e23887: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.transaction(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbg_warn_b1370d804fa3e259: function(arg0) {
            console.warn(arg0);
        },
        __wbg_wasmlinux_new: function(arg0) {
            const ret = WasmLinux.__wrap(arg0);
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 414, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h1dbcf2b5dd15a422);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [I64, I32], shim_idx: 247, ret: I64, inner_ret: Some(I64) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h3c376d590f4b7628);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [I64, I64, I32, I32], shim_idx: 249, ret: I64, inner_ret: Some(I64) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hccc6447b5e5e2a92);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [I64, I64, I32], shim_idx: 242, ret: I64, inner_ret: Some(I64) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hb536c899e9023450);
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [I64, I64, I32], shim_idx: 252, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hf96fc87adc256ad8);
            return ret;
        },
        __wbindgen_cast_0000000000000006: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("ErrorEvent")], shim_idx: 244, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4);
            return ret;
        },
        __wbindgen_cast_0000000000000007: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("Event")], shim_idx: 244, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_6);
            return ret;
        },
        __wbindgen_cast_0000000000000008: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("IDBVersionChangeEvent")], shim_idx: 244, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_7);
            return ret;
        },
        __wbindgen_cast_0000000000000009: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 244, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_8);
            return ret;
        },
        __wbindgen_cast_000000000000000a: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 240, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h880302392ebe5c09);
            return ret;
        },
        __wbindgen_cast_000000000000000b: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_000000000000000c: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_000000000000000d: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./wasm_vm_wasm_bg.js": import0,
        "./snippets/wasm-vm-wasm-0a6604668439f3ad/inline0.js": import1,
    };
}

function wasm_bindgen__convert__closures_____invoke__h880302392ebe5c09(arg0, arg1) {
    wasm.wasm_bindgen__convert__closures_____invoke__h880302392ebe5c09(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_6(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_6(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_7(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_7(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_8(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_8(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h1dbcf2b5dd15a422(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h1dbcf2b5dd15a422(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h8c3f0668a05de02f(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h8c3f0668a05de02f(arg0, arg1, arg2, arg3);
}

function wasm_bindgen__convert__closures_____invoke__hf96fc87adc256ad8(arg0, arg1, arg2, arg3, arg4) {
    wasm.wasm_bindgen__convert__closures_____invoke__hf96fc87adc256ad8(arg0, arg1, arg2, arg3, arg4);
}

function wasm_bindgen__convert__closures_____invoke__hb536c899e9023450(arg0, arg1, arg2, arg3, arg4) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__hb536c899e9023450(arg0, arg1, arg2, arg3, arg4);
    return ret;
}

function wasm_bindgen__convert__closures_____invoke__hccc6447b5e5e2a92(arg0, arg1, arg2, arg3, arg4, arg5) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__hccc6447b5e5e2a92(arg0, arg1, arg2, arg3, arg4, arg5);
    return ret;
}

function wasm_bindgen__convert__closures_____invoke__h3c376d590f4b7628(arg0, arg1, arg2, arg3) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h3c376d590f4b7628(arg0, arg1, arg2, arg3);
    return ret;
}


const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];


const __wbindgen_enum_WorkerType = ["classic", "module"];
const FileSha256Finalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_filesha256_free(ptr, 1));
const WasmLinuxFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlinux_free(ptr, 1));
const WasmMachineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmachine_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('wasm_vm_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
