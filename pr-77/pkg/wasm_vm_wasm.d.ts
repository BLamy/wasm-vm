/* tslint:disable */
/* eslint-disable */

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
 * The core crate version, exposed to JS.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmmachine_free: (a: number, b: number) => void;
    readonly bench: (a: number) => [number, number, number];
    readonly version: () => [number, number];
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
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
