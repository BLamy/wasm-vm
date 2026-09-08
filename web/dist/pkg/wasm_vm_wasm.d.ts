/* tslint:disable */
/* eslint-disable */

/**
 * Incremental SHA-256 for browser `File.stream()` inputs. The UI hashes in bounded chunks before
 * offering a WVFT upload, avoiding `File.arrayBuffer()` and its whole-file heap spike.
 */
export class FileSha256 {
    free(): void;
    [Symbol.dispose](): void;
    finish(): string;
    constructor();
    update(bytes: Uint8Array): void;
}

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
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Advance the overlay commit generation and return the new value. A stored snapshot taken before
     * the advance now fails the coherence guard (`"stale"`) — this is how a durable overlay commit
     * invalidates a now-inconsistent CPU/RAM snapshot.
     */
    advanceOverlayGeneration(): number;
    /**
     * E5-T21d: attach the page-owned microphone ring as the guest's capture source. The ring is
     * allocated before boot but contains no host media handle; permission remains lazy until the
     * guest emits its first successful capture PCM_START edge.
     */
    attachAudioCapture(shared_buffer: SharedArrayBuffer, capacity_frames: number, sample_rate_hz: number): void;
    /**
     * E5-T20e: connect this assembled guest to the page-owned AudioWorklet ring and render clock.
     * The buffers are validated against the T20a header before ownership crosses into the core;
     * an invalid or missing sound device is a hard boot-configuration error rather than silent
     * playback loss.
     */
    attachAudioOutput(shared_buffer: SharedArrayBuffer, clock_buffer: SharedArrayBuffer, capacity_frames: number, sample_rate_hz: number): void;
    /**
     * E5-T06d: attach the page-owned presentation callback after the machine has been assembled.
     * The callback receives `{ scanout, rect, resourceWidth, resourceHeight, pixels }`, where
     * `pixels` is a temporary `Uint32Array` view over wasm memory. The browser sink must copy it
     * synchronously before returning so context-loss replay owns its latest frame.
     */
    attachDisplay(callback: Function): boolean;
    /**
     * E5-T21d: report whether this guest owns the page-provided capture ring.
     */
    audioCaptureReady(): boolean;
    /**
     * E5-T20e: report whether this guest owns the page-provided ring sink. Kept separate from
     * `AudioWorkletSink.stats()` so a browser proof can distinguish an attached guest bridge from
     * a standalone synthetic ring producer.
     */
    audioOutputReady(): boolean;
    beginFileUpload(slot: number, name: string, total: number, sha256_hex: string): number;
    /**
     * E3-T03 dev-mode recorder: the ordered first-touch chunk-access list of this boot as a JSON
     * array — write it to `boot-profile.json` next to the manifest to enable boot-profile prefetch.
     * Empty `[]` for a non-chunked boot.
     */
    bootProfile(): string;
    cancelFileDownload(id: number): void;
    cancelFileUpload(stream: number): void;
    /**
     * E3-T10 (critic BUG-4): close the IndexedDB connection so a `deleteDatabase` (reset-disk)
     * can proceed instead of blocking on our open handle. Call before wiping; the machine must
     * not persist afterward. No-op off the persistent path.
     */
    closeStorage(): void;
    /**
     * E5-T26e: acknowledge a fresh application HELLO from the host T23d Channel. The console
     * transport must already be open; a true result is the only value accepted by the browser
     * restore bridge before it asks the core to publish a desktop snapshot.
     */
    confirmAgentHello(): boolean;
    dismissFileDownload(id: number): boolean;
    dismissFileUpload(stream: number): boolean;
    /**
     * E5-T06d: report whether a page presentation callback owns the assembled GPU sink.
     */
    displayReady(): boolean;
    /**
     * Inspect actual GPU state. Advertised dimensions and bound resource dimensions are
     * deliberately separate: only guest SET_SCANOUT can change the latter. EDID is a copy.
     */
    displayStats(): any;
    /**
     * E4-T29 Phase 2 (browser Linux path): attach the in-wasm JIT executor to THIS Linux guest and
     * arm tier-up. The accelerated interpreter remains the fallback for cold/untranslatable blocks;
     * the caller gates this on `crossOriginIsolated`.
     */
    enableJit(threshold: number): void;
    /**
     * E4-T38: enable the Linux browser JIT under one explicit residency policy. See
     * [`WasmMachine::enable_jit_with_policy`] for the policy labels and cap semantics.
     */
    enableJitWithPolicy(threshold: number, residency_policy: string): void;
    /**
     * E3-T02: fetch (and hash-verify) every chunk the device is parked on, populating the store so
     * the next `runChunk` completes the parked reads. Resolves to the number of chunks newly made
     * resident. No-op (0) for a non-chunked boot. Must not run concurrently with `runChunk` (both
     * borrow the machine); the JS driver alternates them.
     */
    fetchPending(): Promise<number>;
    /**
     * E3-T02/T03 instrumentation: `{ fetches, bytes, error, cache }` — chunk fetches + bytes
     * transferred (pass-4 acceptance), the first fetch error (or null), and the E3-T03 cache metrics
     * `{ hits, misses, evictions, residentBytes, budgetBytes }`. A non-chunked boot reports zeros.
     */
    fetchStats(): any;
    fileTransferReady(slot: number): boolean;
    fileTransferStatus(): string;
    finishFileDownload(id: number, success: boolean): void;
    /**
     * E4-T01: the accumulated profile as a plain JS object — `{ totalNs, sampleCount, walkCount,
     * collisions, regions: [{ pc, samples, pct }], subsystems: [{ name, ns }] }` — mirroring the
     * `getStats` surface the UI already consumes. `pc` is a hex string (a guest PC exceeds 2^53).
     */
    getProfile(): any;
    /**
     * Read-only state: does not sample the clock or consume jump notifications. mtime is a decimal
     * string so worker structured cloning cannot round a guest u64 through JavaScript Number.
     */
    guestClockState(): any;
    /**
     * E3-T10: whether the overlay has unpersisted (dirty) blocks. In persistent writer mode these
     * belong to a virtio WRITE that has not been acknowledged; the quota dialog uses this to say
     * Retry may still complete it, while Continue returns IOERR.
     */
    hasUnpersisted(): boolean;
    /**
     * Persist an externally supplied snapshot blob (AC3 import) into the snapshot store for THIS boot's
     * base image. The blob is bound to this base's namespace; a foreign blob imported here still fails
     * the coherence guard on restore. Framing-corrupt input is replaced by a corrupt marker, and a
     * same-size payload mutation is checked against the digest of the previously published snapshot;
     * both paths make the next decision typed `"corrupt"` rather than falsely `"resume"`. The live
     * machine and overlay are not mutated. The write counter keeps lease release behind this full
     * namespace mutation. Error `"not_persistent"` off the persistent path.
     */
    importStoredSnapshot(blob: Uint8Array): Promise<void>;
    /**
     * E4-T29: the "JIT actually ran" proof for the browser Linux guest. Returns
     * `{hasExecutor, compiledBlocks, executedBlocks, retiredViaJit}` read straight from the installed
     * executor — `executedBlocks > 0` is the definitive evidence translated code executed (not merely
     * that `enableJit` was called). `hasExecutor:false` means no JIT is attached at all.
     */
    jitStats(): any;
    /**
     * Return the latest host-owned LED state reported by the guest keyboard driver. A null
     * result means that this machine was assembled without the virtio-input keyboard capability.
     */
    keyboardLedState(): any;
    /**
     * Restore machine state from a resume blob (all-or-nothing; the coherence header is validated
     * FIRST). A rejected blob is mapped through [`resume::ColdBootReason`] so the JS boundary gets the
     * typed reason (`"missing"`/`"corrupt"`/`"foreign_build"`/`"foreign_image"`/`"stale"`) in the error
     * message rather than a device-internal string. NOT async (pure state application).
     */
    loadSnapshotBlob(blob: Uint8Array): void;
    /**
     * Assemble the platform and boot. `initrd` empty = none; `bootargs` empty = the default
     * `console=ttyS0 earlycon=sbi`. `output(bytes: Uint8Array)` receives console output.
     */
    constructor(ram_mib: number, kernel: Uint8Array, initrd: Uint8Array, bootargs: string, output: Function, enable_mic: boolean);
    /**
     * E3-T02: boot from a CHUNKED image fetched lazily over HTTP. Instead of a full disk `Vec`, take
     * the image `manifest` JSON and the `base_url` its chunks live under (must end in `/`). A guest
     * disk read of an absent chunk parks (deferred virtio-blk completion) until `fetchPending`
     * retrieves and hash-verifies that chunk. No full-image download ever happens.
     */
    static newChunkedDisk(ram_mib: number, kernel: Uint8Array, manifest_json: string, base_url: string, cache_budget_mib: number, boot_profile: Uint32Array, bootargs: string, output: Function, enable_mic: boolean): WasmLinux;
    /**
     * E3-T05: like [`Self::new_chunked_disk`], but the copy-on-write overlay is persisted to
     * IndexedDB — guest writes survive a tab reload. Async: opens the image-namespaced DB (checking
     * its recorded base binding against the manifest — a mismatch/older-version is a typed error, not
     * silent reuse), loads any previously persisted blocks, and boots over them. Call `persistPending`
     * to flush new writes durably (its Promise resolves on the IndexedDB transaction `complete`).
     */
    static newChunkedDiskPersistent(ram_mib: number, kernel: Uint8Array, manifest_json: string, base_url: string, cache_budget_mib: number, boot_profile: Uint32Array, bootargs: string, read_only: boolean, output: Function, seed_identity: string | null | undefined, enable_mic: boolean): Promise<WasmLinux>;
    /**
     * E4-T28e: boot the normal lazy Alpine root disk with one additional read-only virtio-blk
     * image. The extra image is passed by value so the fetched overlay becomes one resident Rust
     * buffer; it is never compiled or transformed on the host. The first free slot after browser
     * Linux's net/rng/keyboard/tablet/mouse reservation is used, leaving `/dev/vdb` as the second
     * block device.
     */
    static newChunkedDiskWithExtra(ram_mib: number, kernel: Uint8Array, manifest_json: string, base_url: string, cache_budget_mib: number, boot_profile: Uint32Array, extra_disk: Uint8Array, bootargs: string, output: Function, enable_mic: boolean): WasmLinux;
    /**
     * E2-T26 capstone: boot from a virtio-blk DISK image (e.g. the Alpine ext4 rootfs) instead of
     * an initramfs. `disk` is MOVED into an in-memory `BlockBackend` (one wasm-side copy — the T21
     * single-copy discipline; a `&[u8]` + `.to_vec()` would double-allocate 512 MB). Default
     * bootargs mount `/dev/vda` as root.
     */
    static newDisk(ram_mib: number, kernel: Uint8Array, disk: Uint8Array, bootargs: string, output: Function, enable_mic: boolean): WasmLinux;
    /**
     * E3-T21d: the persistent driver calls this right after `persistPending` so a durable IndexedDB
     * flush pause — during which the guest is frozen and cannot ACK or heartbeat an in-flight file
     * transfer — does not accrue against the WVFT idle-timeout budget. No-op when nothing is
     * transferring or off the slirp path.
     */
    noteFileTransferPersist(): void;
    /**
     * E5-T21d: turn a host capture lifecycle failure into the existing bounded virtio-snd input
     * XRUN event. The event is delivered through the guest's eventq at the next run boundary;
     * PCM rxq buffers continue to complete with zero-filled, clock-paced data.
     */
    notifyCaptureEvent(event: string): boolean;
    /**
     * The current overlay commit generation (the snapshot coherence's third binding). `u64` fits
     * exactly in an `f64` for every realistic generation count.
     */
    overlayGeneration(): number;
    /**
     * E3-T02: the chunk indices the virtio-blk device is currently parked on (guest reads awaiting a
     * lazy fetch). Empty for a non-chunked boot or when nothing is parked. The JS driver calls this
     * after each `runChunk` and, if non-empty, awaits `fetchPending` before the next `runChunk`.
     */
    pendingChunks(): Uint32Array;
    /**
     * E3-T05: durably flush the overlay's pending writes to IndexedDB. Resolves to the number of
     * blocks persisted; its Promise resolves only after the IndexedDB transaction `complete` event
     * (`durability` per the store), so a caller that awaits it knows the writes survive a reload. A
     * block re-written during the flush is NOT marked persisted (generation guard) and is flushed
     * next call — never lost. No-op (0) for a non-persistent boot. Must not run concurrently with
     * `runChunk` (both borrow the machine); the JS driver alternates them.
     */
    persistPending(): Promise<number>;
    /**
     * Convenience: take a resume snapshot AND durably persist it to the snapshot IndexedDB store in one
     * call. The `RefCell` borrow is scoped to `save_resume` + reading `snapshot_base`; the store I/O
     * runs after it is dropped, never across the borrow. The write counter keeps a lease release
     * from handing the namespace to another tab until this async operation has committed. No-op
     * error `"not_persistent"` off the persistent path (there is no snapshot store to write to).
     */
    persistSnapshot(): Promise<void>;
    /**
     * E3-T08/E3-T10 persistence pressure —
     * `{ pendingBlocks, pendingBytes, flushWaiting, writeWaiting }`. The JS pump persists
     * immediately when a guest WRITE or FLUSH is parked awaiting durable commit; pending bytes
     * over the configured threshold remain the generic write-back backpressure signal. Zeros for
     * non-persistent boots.
     */
    persistStats(): any;
    pushFileUpload(stream: number, bytes: Uint8Array, finished: boolean): number;
    /**
     * Read the persisted snapshot blob back (reassembled), or `null` if none is stored / not on the
     * persistent path. Async (IndexedDB). This is the export/debug surface; production restore uses
     * [`Self::restore_stored_snapshot`] so the blob never crosses the wasm/JS boundary as a second
     * whole-payload copy.
     */
    readStoredSnapshot(): Promise<any>;
    /**
     * Explicit loader pause/resume only. Background gaps keep the core catch-up policy.
     */
    rebaseGuestClock(): void;
    /**
     * Permanently relinquish this machine's snapshot-writer role. Web Locks releases are dynamic:
     * another tab may acquire the same namespace while this controller is still alive, so the
     * construction-time read-only bit alone is not a sufficient fence for a stale controller. New
     * writes are fenced immediately, while writes that already passed the check are allowed to
     * finish before this method resolves. There is intentionally no inverse operation; a new
     * machine must acquire the writer lock before it can save or import snapshots.
     */
    relinquishSnapshotWriter(): Promise<void>;
    /**
     * The header-level resume-vs-cold-boot verdict for `stored` (the reassembled blob, or `None`),
     * against THIS boot's build identity + base binding + `current_generation`. Returns the stable
     * code (`"resume"`/`"missing"`/`"corrupt"`/`"foreign_build"`/`"foreign_image"`/`"stale"`). Off the
     * persistent path (no base binding) there is no snapshot to resume: always `"missing"`.
     */
    restoreDecisionCode(stored: Uint8Array | null | undefined, current_generation: number): string;
    /**
     * E5-T26e: restore the versioned desktop envelope after the host Channel has completed its
     * fresh HELLO intersection. The returned JSON-safe report is consumed by the T22 viewport
     * owner; this call never silently attests success when the live console/device composition is
     * unavailable.
     */
    restoreDesktopSnapshot(blob: Uint8Array, host_width: number, host_height: number): any;
    /**
     * Load and, only when coherent, apply the persisted snapshot directly inside wasm. The stored
     * blob is held by one Rust allocation while the coherence header is checked and the machine is
     * restored; unlike `readStoredSnapshot` this path does not create a JS `Uint8Array` boundary copy.
     * Returns the same typed decision code as `restoreDecisionCode`, with no machine mutation for a
     * missing, corrupt, foreign, or stale snapshot.
     */
    restoreStoredSnapshot(): Promise<string>;
    /**
     * Run up to `max_instrs`, drain console output to the JS callback, feed queued input to the
     * 16550 RX, and return `{ done: bool, state: string|null, retired: number }`. A persistent caller may pass
     * `persist_max_dirty_bytes`; execution then yields as soon as the write-back queue reaches
     * that limit so JS can durably drain it before the guest can race arbitrarily far ahead.
     * `state` is `"poweroff"`, `"reboot"`, `"fail:<code>"`, `"exited:<code>"`, or
     * `"trap:<cause>"` once terminal.
     */
    runChunk(max_instrs: number, persist_max_dirty_bytes?: number | null): any;
    /**
     * E5-T26f: take the live GPU/input/sound/agent component state at one bounded scheduler
     * boundary. The core composes the existing codecs; this boundary only owns the JS byte copy.
     */
    saveDesktopSnapshot(): any;
    /**
     * Take a whole-machine resume snapshot and return its bytes as a `Uint8Array`. NOT async and NOT
     * persisting — kept synchronous so the `RefCell` borrow is never held across an `await` (the JS
     * caller may drive persistence itself, or use [`Self::persist_snapshot`]). `save_resume` quiesces
     * virtio-blk first; if the in-flight set cannot drain, the error message starts with
     * `"not_quiesced"` so the caller can retry rather than treat it as a hard failure; any other error
     * starts with `"save_error"`.
     */
    saveSnapshot(): any;
    /**
     * E5-T26f: enqueue one owned host-to-guest frame on the named virtio-console agent port.
     * Returning the accepted byte count lets the page Channel fail closed on bounded
     * backpressure instead of silently reporting that a frame was delivered.
     */
    sendAgentInput(bytes: Uint8Array): number;
    /**
     * Queue host keystrokes for the guest's `ttyS0` (fed to the RX FIFO across `runChunk`s).
     */
    sendInput(bytes: Uint8Array): void;
    /**
     * Queue one guest-visible evdev keyboard event. Call `syncKeyboard` after the host's
     * keydown/keyup event (or after a batch of related events) to publish the frame with its
     * `SYN_REPORT`; browser repeat events must not call this method as key-downs.
     */
    sendKeyboardEvent(event_type: number, code: number, value: number): void;
    /**
     * Queue one guest-visible relative-mouse event. Call `syncMouse` after the complete DOM
     * pointer frame so the guest receives exactly one `EV_SYN/SYN_REPORT` terminator.
     */
    sendMouseEvent(event_type: number, code: number, value: number): void;
    /**
     * Queue one guest-visible absolute-tablet event. Call `syncTablet` after the complete DOM
     * pointer frame so the guest receives exactly one `EV_SYN/SYN_REPORT` terminator.
     */
    sendTabletEvent(event_type: number, code: number, value: number): void;
    /**
     * E4-T39: toggle static region chaining without rebuilding the generated modules.
     */
    setChaining(on: boolean): void;
    /**
     * E5-T26k: select one bounded decoded-cache capacity, without coercing JavaScript values.
     */
    setDecodedCacheEntries(value: any): void;
    /**
     * E3-T10: flip the disk to read-only at runtime — the "continue read-only" choice after a
     * storage-quota hit. Subsequent guest writes get EIO (VIRTIO_BLK_F_RO / BlockError::ReadOnly)
     * so the guest sees an honest I/O error instead of a silently-undurable write. No-op off the
     * persistent path. Returns true if a disk flag was flipped.
     */
    setDiskReadOnly(): boolean;
    /**
     * Request a preferred display mode. This does not resize a guest resource or claim the
     * compositor has adopted the mode. Validate both JS values before borrowing/mutating state.
     */
    setDisplay(width: any, height: any): boolean;
    /**
     * E4-T39: toggle generated dynamic-return (`jalr`) chaining independently of static regions.
     */
    setDynamicChaining(on: boolean): void;
    /**
     * E4-T30: select the production interpreter fast path for a browser Linux guest. It combines
     * physical-entry predecode reuse with the proven <=128-retire interrupt/device batching. The
     * caller can turn it off for a byte-identical legacy A/B; enabling JIT later turns it back on
     * because the compiled tier consumes the same block-discovery front end.
     */
    setFastInterpreter(on: boolean): void;
    setFileDownloadReady(ready: boolean): void;
    /**
     * E5-T26i: opt in to realm-monotonic guest time, or retain the deterministic ICount oracle.
     * Unsupported labels and unavailable performance sources refuse before any clock mutation.
     */
    setGuestClock(mode: string): void;
    /**
     * Explicit deterministic retirements-per-tick selection; never silently coerce JS input.
     */
    setICountDivider(value: any): void;
    /**
     * E4-T01: arm/disarm the hot-PC + subsystem-time profiler for this boot. Arming injects a
     * `performance.now()`-backed [`JsHostTimer`]; sampling is 1-in-~1024 retires + cold-path-only
     * timing (~0 overhead). Returns `false` if no `performance` object is available to arm it.
     */
    setProfiling(on: boolean): boolean;
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
     */
    stampBootSnapshotIdentity(base_id: Uint8Array): void;
    /**
     * Final/current guest-RAM SHA-256 for browser evidence. This is the `mem_digest` portion of the
     * native snapshot contract; registers and device state are intentionally not encoded here.
     */
    stateDigest(): string;
    /**
     * Publish the current host keyboard frame by appending `EV_SYN/SYN_REPORT`.
     */
    syncKeyboard(): void;
    /**
     * Publish the current host relative-mouse frame with `EV_SYN/SYN_REPORT`.
     */
    syncMouse(): void;
    /**
     * Publish the current host absolute-tablet frame with `EV_SYN/SYN_REPORT`.
     */
    syncTablet(): void;
    /**
     * E5-T26f: drain complete guest-to-host agent frames after a run slice. The returned copy is
     * transferred through the worker protocol and then decoded by the page-owned T23d Channel.
     */
    takeAgentOutput(): Uint8Array;
    takeFileDownloadChunk(id: number): Uint8Array;
    /**
     * E5-T21d: expose the input PCM lifecycle edge to the page. `startCount` increments only for
     * successful guest PCM_START requests; the page uses it to make getUserMedia lazy and to
     * re-request after a later guest retry without polling host media state speculatively.
     */
    virtioSndCaptureState(): any;
    /**
     * E5-T21b: expose the assembled sound configuration for browser diagnostics. This is a
     * read-only construction proof; the input stream metadata comes from the same core state that
     * answers guest PCM_INFO, and no host capture handle is created by reading it.
     */
    virtioSndConfig(): any;
}

/**
 * JS-facing handle over [`wasm_vm_core::Machine`].
 */
export class WasmMachine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * E4-T29 Phase 2: attach the in-wasm (browser) JIT executor to this machine and arm tier-up.
     * Mirrors the native CLI `--jit` wiring (constructs the executor, calls `set_executor`, turns on
     * the block cache + interrupt batching + hotness discovery) so a booted browser guest executes
     * translated blocks. The interpreter stays the oracle: with the JIT off (this never called) the
     * run loop is byte-identical to the pre-T29 path. `threshold` is the hotness count before a block
     * is nominated for compilation (1 = eager, for tests). The caller is responsible for gating this
     * on `crossOriginIsolated` (E4-T22 `selectJitBackend`) — see `web/cpu-isolation.js`.
     */
    enableJit(threshold: number): void;
    /**
     * E4-T38: attach the browser JIT with one explicit residency screen. `repack-off` is the
     * current single-pass batcher with the conservative 24-module browser cap; `cap-256` and
     * `cap-1024` retain the same translator and eviction policy while changing only the live-batch
     * cap. Validate and apply the policy before publishing the executor so a bad benchmark label
     * cannot leave a partially initialized machine.
     */
    enableJitWithPolicy(threshold: number, residency_policy: string): void;
    /**
     * E2-T20: the interrupt/trap counters + storm/WFI diagnosis as a JS object
     * `{ retired, wfi, exceptions:[16], interrupts:[16], claims:[32], storm:bool, wfiReport:string|null }`.
     * E2-T26's UI surfaces these so a browser boot that death-spirals shows a diagnosis instead
     * of a silently-pinned tab.
     */
    getStats(): any;
    /**
     * E4-T31: the bare-metal wrapper's authoritative compiled-tier counters. This mirrors the
     * Linux wrapper and lets hosts distinguish a bounded JIT run from an interpreted trace run.
     */
    jitStats(): any;
    /**
     * Load a bare-metal rv64 ELF. A malformed image throws a `JsError` naming the
     * `ElfError` variant and leaves the machine usable (RAM is validated before it is
     * written).
     */
    loadElf(bytes: Uint8Array): void;
    /**
     * Construct a machine with `ram_mib` MiB of zeroed guest RAM and a UART0 console
     * wired to a (initially unset) JS callback. A `ram_mib` too large to allocate throws
     * a catchable `JsError` — never a wasm `unreachable` abort that would poison the
     * module (the allocation goes through `try_reserve_exact`).
     */
    constructor(ram_mib: number);
    /**
     * Size of guest RAM in bytes.
     */
    ramLen(): number;
    /**
     * The 33 architectural registers as a `BigUint64Array`: `[pc, x0, x1, …, x31]`.
     */
    registers(): BigUint64Array;
    /**
     * Run up to `max_instrs` instructions, returning a status object:
     * `{ kind: "exited"|"trapped"|"max", code?, cause?, tval?, retired }`.
     */
    run(max_instrs: number): any;
    /**
     * E4-T39: toggle static region chaining without rebuilding the generated modules.
     */
    setChaining(on: boolean): void;
    /**
     * Install (or replace) the per-byte console callback: `fn(byte: number)`.
     */
    setConsole(cb: Function): void;
    /**
     * E4-T39: toggle generated dynamic-return (`jalr`) chaining independently of static regions.
     */
    setDynamicChaining(on: boolean): void;
    /**
     * Arm or disarm the same profiler used by the Linux wrapper. Browser-JIT entry clocks follow
     * this state, while their deterministic structural counters remain enabled in both modes.
     */
    setProfiling(on: boolean): boolean;
    /**
     * Enable or disable canonical instruction tracing (appended to an internal buffer;
     * drain it with `takeTrace`).
     */
    setTrace(on: boolean): void;
    /**
     * SHA-256 of guest RAM as 64 lowercase hex chars (matches the CLI `--dump-state`).
     */
    stateDigest(): string;
    /**
     * Step up to `n` instructions, returning how many retired. Same engine as `run`
     * (HTIF is consulted), but the caller reads a plain count instead of a status object.
     */
    step(n: number): number;
    /**
     * Take and clear the accumulated canonical trace.
     */
    takeTrace(): string;
}

/**
 * Instructions-per-second baseline (E0-T24), node + browser side. Runs `loops.elf` on the
 * trace-off (`run`) path repeatedly until at least `target_instrs` instructions have
 * retired (`≥ 10^7` keeps JS↔wasm boundary chatter out of the measurement), and returns a
 * `{ retired, ms }` object timed with `Date.now()`. MIPS = `retired / ms / 1000`. Each run
 * retires exactly the golden count (a reload is a clean reset), so `retired` is exact.
 */
export function bench(target_instrs: number): any;

export function initLogging(): void;

/**
 * E3-T10: the IndexedDB database name that holds a given image's durable overlay — so the
 * "reset disk" flow can `indexedDB.deleteDatabase(name)` for THIS image only (a second image's
 * overlay, in a different DB, survives). Same derivation the durable store uses
 * (`overlay_store_name(base_hash)` for legacy boots, or the exact shipped RAM+delta pair's
 * independent seed namespace), so it always matches. Omitting `seed_identity` preserves the
 * legacy name.
 */
export function overlayDbName(manifest_json: string, seed_identity?: string | null): string;

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
 */
export function seedOverlayDelta(manifest_json: string, delta_bytes: Uint8Array, seed_identity?: string | null): Promise<boolean>;

/**
 * Configure the DHCP lease duration for subsequent boots (used by the renewal acceptance).
 */
export function setSlirpDhcpLeaseSeconds(seconds: number): void;

/**
 * Configure the RFC 8484 wire-format DoH endpoint. Empty restores the production default.
 */
export function setSlirpDohEndpoint(endpoint: string): void;

/**
 * Configure the DHCP-advertised link MTU for subsequent boots.
 */
export function setSlirpMtu(mtu: number): void;

/**
 * Choose the slirp local network stack (vs the default loopback) for subsequent boots.
 */
export function setSlirpNet(on: boolean): void;

/**
 * Configure the WebSocket relay used for outbound TCP on subsequent slirp boots. An empty URL
 * keeps the local-only DHCP/ARP/ICMP stack.
 */
export function setSlirpRelay(url: string): void;

/**
 * Stage a short-lived relay credential for exactly the next boot. It is kept out of URLs and
 * consumed when the connector is constructed, so a later boot cannot silently replay it.
 */
export function setSlirpRelayToken(token: string): void;

/**
 * Configure the dedicated Tailscale provider Worker for the next slirp boot. The structured
 * config is consumed when the Worker starts; credentials are never placed in the Worker URL.
 * Empty `url` selects no Tailscale provider and drops any previously staged config.
 */
export function setSlirpTailscaleWorker(url: string, config: any): void;

/**
 * Snapshot the current boot's production DHCP exchanges for evidence and diagnostics.
 */
export function slirpDhcpStats(): string;

/**
 * Send a credential-free lifecycle command to the active provider Worker. Returns false when
 * no Tailscale provider owns this boot (relay/offline selection never creates a Worker).
 */
export function slirpTailscaleCommand(command: string): boolean;

/**
 * The core crate version, exposed to JS.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_filesha256_free: (a: number, b: number) => void;
    readonly __wbg_wasmlinux_free: (a: number, b: number) => void;
    readonly __wbg_wasmmachine_free: (a: number, b: number) => void;
    readonly bench: (a: number) => [number, number, number];
    readonly filesha256_finish: (a: number) => [number, number, number, number];
    readonly filesha256_new: () => number;
    readonly filesha256_update: (a: number, b: number, c: number) => [number, number];
    readonly overlayDbName: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly seedOverlayDelta: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly version: () => [number, number];
    readonly wasmlinux_advanceOverlayGeneration: (a: number) => [number, number, number];
    readonly wasmlinux_attachAudioCapture: (a: number, b: any, c: number, d: number) => [number, number];
    readonly wasmlinux_attachAudioOutput: (a: number, b: any, c: any, d: number, e: number) => [number, number];
    readonly wasmlinux_attachDisplay: (a: number, b: any) => [number, number, number];
    readonly wasmlinux_audioCaptureReady: (a: number) => [number, number, number];
    readonly wasmlinux_audioOutputReady: (a: number) => [number, number, number];
    readonly wasmlinux_beginFileUpload: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly wasmlinux_bootProfile: (a: number) => [number, number, number, number];
    readonly wasmlinux_cancelFileDownload: (a: number, b: number) => [number, number];
    readonly wasmlinux_cancelFileUpload: (a: number, b: number) => [number, number];
    readonly wasmlinux_closeStorage: (a: number) => [number, number];
    readonly wasmlinux_confirmAgentHello: (a: number) => [number, number, number];
    readonly wasmlinux_dismissFileDownload: (a: number, b: number) => [number, number, number];
    readonly wasmlinux_dismissFileUpload: (a: number, b: number) => [number, number, number];
    readonly wasmlinux_displayReady: (a: number) => [number, number, number];
    readonly wasmlinux_displayStats: (a: number) => [number, number, number];
    readonly wasmlinux_enableJit: (a: number, b: number) => [number, number];
    readonly wasmlinux_enableJitWithPolicy: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasmlinux_fetchPending: (a: number) => any;
    readonly wasmlinux_fetchStats: (a: number) => [number, number, number];
    readonly wasmlinux_fileTransferReady: (a: number, b: number) => [number, number, number];
    readonly wasmlinux_fileTransferStatus: (a: number) => [number, number, number, number];
    readonly wasmlinux_finishFileDownload: (a: number, b: number, c: number) => [number, number];
    readonly wasmlinux_getProfile: (a: number) => [number, number, number];
    readonly wasmlinux_guestClockState: (a: number) => [number, number, number];
    readonly wasmlinux_hasUnpersisted: (a: number) => [number, number, number];
    readonly wasmlinux_importStoredSnapshot: (a: number, b: number, c: number) => any;
    readonly wasmlinux_jitStats: (a: number) => [number, number, number];
    readonly wasmlinux_keyboardLedState: (a: number) => [number, number, number];
    readonly wasmlinux_loadSnapshotBlob: (a: number, b: number, c: number) => [number, number];
    readonly wasmlinux_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any, i: number) => [number, number, number];
    readonly wasmlinux_newChunkedDisk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any, n: number) => [number, number, number];
    readonly wasmlinux_newChunkedDiskPersistent: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: any, o: number, p: number, q: number) => any;
    readonly wasmlinux_newChunkedDiskWithExtra: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: any, p: number) => [number, number, number];
    readonly wasmlinux_newDisk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any, i: number) => [number, number, number];
    readonly wasmlinux_noteFileTransferPersist: (a: number) => [number, number];
    readonly wasmlinux_notifyCaptureEvent: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmlinux_overlayGeneration: (a: number) => [number, number, number];
    readonly wasmlinux_pendingChunks: (a: number) => [number, number, number, number];
    readonly wasmlinux_persistPending: (a: number) => any;
    readonly wasmlinux_persistSnapshot: (a: number) => any;
    readonly wasmlinux_persistStats: (a: number) => [number, number, number];
    readonly wasmlinux_pushFileUpload: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmlinux_readStoredSnapshot: (a: number) => any;
    readonly wasmlinux_rebaseGuestClock: (a: number) => [number, number];
    readonly wasmlinux_relinquishSnapshotWriter: (a: number) => any;
    readonly wasmlinux_restoreDecisionCode: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasmlinux_restoreDesktopSnapshot: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmlinux_restoreStoredSnapshot: (a: number) => any;
    readonly wasmlinux_runChunk: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmlinux_saveDesktopSnapshot: (a: number) => [number, number, number];
    readonly wasmlinux_saveSnapshot: (a: number) => [number, number, number];
    readonly wasmlinux_sendAgentInput: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmlinux_sendInput: (a: number, b: number, c: number) => [number, number];
    readonly wasmlinux_sendKeyboardEvent: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasmlinux_sendMouseEvent: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasmlinux_sendTabletEvent: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasmlinux_setChaining: (a: number, b: number) => [number, number];
    readonly wasmlinux_setDecodedCacheEntries: (a: number, b: any) => [number, number];
    readonly wasmlinux_setDiskReadOnly: (a: number) => [number, number, number];
    readonly wasmlinux_setDisplay: (a: number, b: any, c: any) => [number, number, number];
    readonly wasmlinux_setDynamicChaining: (a: number, b: number) => [number, number];
    readonly wasmlinux_setFastInterpreter: (a: number, b: number) => [number, number];
    readonly wasmlinux_setFileDownloadReady: (a: number, b: number) => [number, number];
    readonly wasmlinux_setGuestClock: (a: number, b: number, c: number) => [number, number];
    readonly wasmlinux_setICountDivider: (a: number, b: any) => [number, number];
    readonly wasmlinux_setProfiling: (a: number, b: number) => [number, number, number];
    readonly wasmlinux_stampBootSnapshotIdentity: (a: number, b: number, c: number) => [number, number];
    readonly wasmlinux_stateDigest: (a: number) => [number, number, number, number];
    readonly wasmlinux_syncKeyboard: (a: number) => [number, number];
    readonly wasmlinux_syncMouse: (a: number) => [number, number];
    readonly wasmlinux_syncTablet: (a: number) => [number, number];
    readonly wasmlinux_takeAgentOutput: (a: number) => [number, number, number];
    readonly wasmlinux_takeFileDownloadChunk: (a: number, b: number) => [number, number, number];
    readonly wasmlinux_virtioSndCaptureState: (a: number) => [number, number, number];
    readonly wasmlinux_virtioSndConfig: (a: number) => [number, number, number];
    readonly wasmmachine_enableJit: (a: number, b: number) => [number, number];
    readonly wasmmachine_enableJitWithPolicy: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasmmachine_getStats: (a: number) => [number, number, number];
    readonly wasmmachine_jitStats: (a: number) => [number, number, number];
    readonly wasmmachine_loadElf: (a: number, b: number, c: number) => [number, number];
    readonly wasmmachine_new: (a: number) => [number, number, number];
    readonly wasmmachine_ramLen: (a: number) => [number, number, number];
    readonly wasmmachine_registers: (a: number) => [number, number, number];
    readonly wasmmachine_run: (a: number, b: number) => [number, number, number];
    readonly wasmmachine_setChaining: (a: number, b: number) => [number, number];
    readonly wasmmachine_setConsole: (a: number, b: any) => [number, number];
    readonly wasmmachine_setDynamicChaining: (a: number, b: number) => [number, number];
    readonly wasmmachine_setProfiling: (a: number, b: number) => [number, number, number];
    readonly wasmmachine_setTrace: (a: number, b: number) => [number, number];
    readonly wasmmachine_stateDigest: (a: number) => [number, number, number, number];
    readonly wasmmachine_step: (a: number, b: number) => [number, number, number];
    readonly wasmmachine_takeTrace: (a: number) => [number, number, number, number];
    readonly initLogging: () => void;
    readonly setSlirpDhcpLeaseSeconds: (a: number) => void;
    readonly setSlirpDohEndpoint: (a: number, b: number) => void;
    readonly setSlirpMtu: (a: number) => void;
    readonly setSlirpNet: (a: number) => void;
    readonly setSlirpRelay: (a: number, b: number) => void;
    readonly setSlirpRelayToken: (a: number, b: number) => void;
    readonly setSlirpTailscaleWorker: (a: number, b: number, c: any) => void;
    readonly slirpDhcpStats: () => [number, number];
    readonly slirpTailscaleCommand: (a: number, b: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__h1dbcf2b5dd15a422: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h8c3f0668a05de02f: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_6: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_7: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h16552ffdf129f8f4_8: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h3c376d590f4b7628: (a: number, b: number, c: bigint, d: number) => bigint;
    readonly wasm_bindgen__convert__closures_____invoke__hccc6447b5e5e2a92: (a: number, b: number, c: bigint, d: bigint, e: number, f: number) => bigint;
    readonly wasm_bindgen__convert__closures_____invoke__hb536c899e9023450: (a: number, b: number, c: bigint, d: bigint, e: number) => bigint;
    readonly wasm_bindgen__convert__closures_____invoke__hf96fc87adc256ad8: (a: number, b: number, c: bigint, d: bigint, e: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h880302392ebe5c09: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
