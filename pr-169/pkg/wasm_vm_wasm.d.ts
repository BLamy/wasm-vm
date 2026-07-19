/* tslint:disable */
/* eslint-disable */

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
     * E3-T03 dev-mode recorder: the ordered first-touch chunk-access list of this boot as a JSON
     * array — write it to `boot-profile.json` next to the manifest to enable boot-profile prefetch.
     * Empty `[]` for a non-chunked boot.
     */
    bootProfile(): string;
    /**
     * E3-T08: persistence pressure — `{ pendingBlocks, pendingBytes, flushWaiting }`. The JS pump
     * reads this each tick: `flushWaiting` (a guest FLUSH is parked awaiting the durable commit)
     * means persist IMMEDIATELY — the guest's `sync` is blocked on it; `pendingBytes` over the
     * driver's dirty-bytes threshold means apply backpressure (persist before the next run slice)
     * so an unflushed session cannot accumulate unbounded dirty state. Zeros for non-persistent
     * boots.
     * E3-T10 (critic BUG-4): close the IndexedDB connection so a `deleteDatabase` (reset-disk)
     * can proceed instead of blocking on our open handle. Call before wiping; the machine must
     * not persist afterward. No-op off the persistent path.
     */
    closeStorage(): void;
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
    /**
     * E3-T10: whether the overlay has unpersisted (dirty) blocks — after a quota hit the caller
     * checks this to decide whether flipping read-only is enough (pending writes will retry once
     * space is freed) vs. data that can never become durable.
     */
    hasUnpersisted(): boolean;
    /**
     * Assemble the platform and boot. `initrd` empty = none; `bootargs` empty = the default
     * `console=ttyS0 earlycon=sbi`. `output(bytes: Uint8Array)` receives console output.
     */
    constructor(ram_mib: number, kernel: Uint8Array, initrd: Uint8Array, bootargs: string, output: Function);
    /**
     * E3-T02: boot from a CHUNKED image fetched lazily over HTTP. Instead of a full disk `Vec`, take
     * the image `manifest` JSON and the `base_url` its chunks live under (must end in `/`). A guest
     * disk read of an absent chunk parks (deferred virtio-blk completion) until `fetchPending`
     * retrieves and hash-verifies that chunk. No full-image download ever happens.
     */
    static newChunkedDisk(ram_mib: number, kernel: Uint8Array, manifest_json: string, base_url: string, cache_budget_mib: number, boot_profile: Uint32Array, bootargs: string, output: Function): WasmLinux;
    /**
     * E3-T05: like [`Self::new_chunked_disk`], but the copy-on-write overlay is persisted to
     * IndexedDB — guest writes survive a tab reload. Async: opens the image-namespaced DB (checking
     * its recorded base binding against the manifest — a mismatch/older-version is a typed error, not
     * silent reuse), loads any previously persisted blocks, and boots over them. Call `persistPending`
     * to flush new writes durably (its Promise resolves on the IndexedDB transaction `complete`).
     */
    static newChunkedDiskPersistent(ram_mib: number, kernel: Uint8Array, manifest_json: string, base_url: string, cache_budget_mib: number, boot_profile: Uint32Array, bootargs: string, read_only: boolean, output: Function): Promise<WasmLinux>;
    /**
     * E2-T26 capstone: boot from a virtio-blk DISK image (e.g. the Alpine ext4 rootfs) instead of
     * an initramfs. `disk` is MOVED into an in-memory `BlockBackend` (one wasm-side copy — the T21
     * single-copy discipline; a `&[u8]` + `.to_vec()` would double-allocate 512 MB). Default
     * bootargs mount `/dev/vda` as root.
     */
    static newDisk(ram_mib: number, kernel: Uint8Array, disk: Uint8Array, bootargs: string, output: Function): WasmLinux;
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
    persistStats(): any;
    /**
     * Run up to `max_instrs`, drain console output to the JS callback, feed queued input to the
     * 16550 RX, and return `{ done: bool, state: string|null }`. `state` is `"poweroff"`,
     * `"reboot"`, `"fail:<code>"`, `"exited:<code>"`, or `"trap:<cause>"` once terminal.
     */
    runChunk(max_instrs: number): any;
    /**
     * Queue host keystrokes for the guest's `ttyS0` (fed to the RX FIFO across `runChunk`s).
     */
    sendInput(bytes: Uint8Array): void;
    /**
     * E3-T10: flip the disk to read-only at runtime — the "continue read-only" choice after a
     * storage-quota hit. Subsequent guest writes get EIO (VIRTIO_BLK_F_RO / BlockError::ReadOnly)
     * so the guest sees an honest I/O error instead of a silently-undurable write. No-op off the
     * persistent path. Returns true if a disk flag was flipped.
     */
    setDiskReadOnly(): boolean;
    /**
     * Final/current architectural-state SHA-256 for browser evidence. This covers registers, CSRs,
     * devices, and RAM through the same snapshot contract as native `--dump-state` / boot evidence.
     */
    stateDigest(): string;
}

/**
 * JS-facing handle over [`wasm_vm_core::Machine`].
 */
export class WasmMachine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * E2-T20: the interrupt/trap counters + storm/WFI diagnosis as a JS object
     * `{ retired, wfi, exceptions:[16], interrupts:[16], claims:[32], storm:bool, wfiReport:string|null }`.
     * E2-T26's UI surfaces these so a browser boot that death-spirals shows a diagnosis instead
     * of a silently-pinned tab.
     */
    getStats(): any;
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
     * Install (or replace) the per-byte console callback: `fn(byte: number)`.
     */
    setConsole(cb: Function): void;
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
 * (`overlay_store_name(base_hash)`), so it always matches.
 */
export function overlayDbName(manifest_json: string): string;

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
 * Snapshot the current boot's production DHCP exchanges for evidence and diagnostics.
 */
export function slirpDhcpStats(): string;

/**
 * The core crate version, exposed to JS.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmlinux_free: (a: number, b: number) => void;
    readonly __wbg_wasmmachine_free: (a: number, b: number) => void;
    readonly bench: (a: number) => [number, number, number];
    readonly overlayDbName: (a: number, b: number) => [number, number, number, number];
    readonly version: () => [number, number];
    readonly wasmlinux_bootProfile: (a: number) => [number, number, number, number];
    readonly wasmlinux_closeStorage: (a: number) => [number, number];
    readonly wasmlinux_fetchPending: (a: number) => any;
    readonly wasmlinux_fetchStats: (a: number) => [number, number, number];
    readonly wasmlinux_hasUnpersisted: (a: number) => [number, number, number];
    readonly wasmlinux_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any) => [number, number, number];
    readonly wasmlinux_newChunkedDisk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any) => [number, number, number];
    readonly wasmlinux_newChunkedDiskPersistent: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: any) => any;
    readonly wasmlinux_newDisk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any) => [number, number, number];
    readonly wasmlinux_pendingChunks: (a: number) => [number, number, number, number];
    readonly wasmlinux_persistPending: (a: number) => any;
    readonly wasmlinux_persistStats: (a: number) => [number, number, number];
    readonly wasmlinux_runChunk: (a: number, b: number) => [number, number, number];
    readonly wasmlinux_sendInput: (a: number, b: number, c: number) => [number, number];
    readonly wasmlinux_setDiskReadOnly: (a: number) => [number, number, number];
    readonly wasmlinux_stateDigest: (a: number) => [number, number, number, number];
    readonly wasmmachine_getStats: (a: number) => [number, number, number];
    readonly wasmmachine_loadElf: (a: number, b: number, c: number) => [number, number];
    readonly wasmmachine_new: (a: number) => [number, number, number];
    readonly wasmmachine_ramLen: (a: number) => [number, number, number];
    readonly wasmmachine_registers: (a: number) => [number, number, number];
    readonly wasmmachine_run: (a: number, b: number) => [number, number, number];
    readonly wasmmachine_setConsole: (a: number, b: any) => [number, number];
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
    readonly slirpDhcpStats: () => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h4dab88d0e3c13e7c: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h583f8b0f4fac6275: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h3938909b4fe9eea0: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h3938909b4fe9eea0_2: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h3938909b4fe9eea0_3: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hbf16adea65433f6b: (a: number, b: number) => void;
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
