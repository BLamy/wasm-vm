// E4-T22: main-thread controller for the CPU worker. Spawns the worker, allocates the shared
// WebAssembly.Memory + control block, runs the boot handshake, and services WFI wakeups + interim
// blocking MMIO on behalf of the parked worker. The DOM / xterm.js / devices stay on this thread.
//
// This is the THREADED backend. The caller only reaches it after cpu-isolation.selectCpuBackend
// returned `worker-shared`; the single-threaded fallback uses the existing in-line WasmMachine path
// and never touches this module.

import {
  createControlBlock,
  raiseIrq,
  mmioPending,
  mmioRespond,
  CELL,
  STATE,
} from "./cpu-control-block.js";

const PAGE = 64 * 1024;

/**
 * Create the shared guest memory. Must be `shared:true` (SharedArrayBuffer-backed) so the worker
 * and main thread see the same guest RAM. `maximum` is mandatory for shared memories.
 * @param {number} ramMiB guest RAM in MiB
 * @param {number} maxMiB hard ceiling (defaults to 2 GiB — matches build-web-shared max-memory)
 */
export function createSharedGuestMemory(ramMiB, maxMiB = 2048) {
  const initial = Math.ceil((ramMiB * 1024 * 1024) / PAGE);
  const maximum = Math.ceil((maxMiB * 1024 * 1024) / PAGE);
  const mem = new WebAssembly.Memory({ initial, maximum, shared: true });
  if (!(mem.buffer instanceof SharedArrayBuffer)) {
    throw new Error("WebAssembly.Memory is not SharedArrayBuffer-backed — page not isolated");
  }
  return mem;
}

/**
 * Boot the CPU on a dedicated worker.
 * @param {object} opts
 * @param {string} opts.workerUrl        URL of cpu-worker.js
 * @param {WebAssembly.Module|string} opts.wasm  a pre-compiled Module, or a URL to compile in-worker
 * @param {WebAssembly.Memory} opts.sharedMemory shared guest memory (from createSharedGuestMemory)
 * @param {object} opts.bootParams       kernel/initramfs/dtb offsets, RAM size…
 * @param {(rec:object)=>void} [opts.onLog]
 * @param {(err:string)=>void} [opts.onFatal]
 * @param {(addr:bigint,width:number,write:boolean,value:bigint)=>bigint} [opts.serviceMmio]
 *        interim device access handler (returns the load result; E4-T23 makes this the real proxy)
 * @returns {Promise<CpuWorkerHandle>}
 */
export function bootCpuWorker(opts) {
  const { workerUrl, wasm, sharedMemory, bootParams, onLog, onFatal, serviceMmio } = opts;
  const { sab: controlSab, cells } = createControlBlock();
  const worker = new Worker(workerUrl, { type: "module" });

  return new Promise((resolve, reject) => {
    let settled = false;
    worker.addEventListener("message", (event) => {
      const msg = event.data;
      switch (msg?.type) {
        case "ready":
          if (!settled) {
            settled = true;
            resolve(new CpuWorkerHandle(worker, cells, serviceMmio));
          }
          break;
        case "log":
          onLog?.(msg.record);
          break;
        case "halted":
          onLog?.({ level: "info", text: "guest halted" });
          break;
        case "fatal":
          // A worker crash (or DevTools-killed worker) surfaces as a clean fatal, not a whitescreen.
          Atomics.store(cells, CELL.STATE, STATE.FATAL);
          onFatal?.(msg.error);
          if (!settled) {
            settled = true;
            reject(new Error(msg.error));
          }
          break;
      }
    });
    worker.addEventListener("error", (e) => {
      Atomics.store(cells, CELL.STATE, STATE.FATAL);
      onFatal?.(String(e.message || e));
      if (!settled) {
        settled = true;
        reject(new Error(String(e.message || e)));
      }
    });

    const boot = {
      type: "boot",
      sharedMemory,
      controlSab,
      bootParams,
    };
    if (typeof wasm === "string") boot.wasmUrl = wasm;
    else boot.wasmModule = wasm; // WebAssembly.Module is structured-cloneable
    worker.postMessage(boot);

    // Drain interim blocking MMIO while the worker is parked on a device access.
    if (serviceMmio) startMmioPump(cells, serviceMmio);
  });
}

// Poll the control block for a pending blocking-MMIO request and service it. This is the interim
// stub (E4-T23 replaces it with an async device proxy). rAF-paced so it never blocks the main
// thread's frame budget.
function startMmioPump(cells, serviceMmio) {
  const pump = () => {
    const pend = mmioPending(cells);
    if (pend) {
      let result = 0n;
      try {
        result = serviceMmio(pend.addr, pend.width, pend.write, pend.value) ?? 0n;
      } catch (err) {
        result = 0n;
        console.error("[cpu] MMIO service error", err);
      }
      mmioRespond(cells, pend.req, result);
    }
    (globalThis.requestAnimationFrame || setTimeout)(pump, 0);
  };
  (globalThis.requestAnimationFrame || setTimeout)(pump, 0);
}

export class CpuWorkerHandle {
  constructor(worker, cells, serviceMmio) {
    this.worker = worker;
    this.cells = cells;
    this._serviceMmio = serviceMmio;
  }

  /** Raise a guest interrupt and wake the parked worker (e.g. a UART keypress, timer, virtio IRQ). */
  raiseInterrupt() {
    return raiseIrq(this.cells);
  }

  /** Current worker lifecycle state (STATE.*). */
  state() {
    return Atomics.load(this.cells, CELL.STATE);
  }

  isParked() {
    return this.state() === STATE.PARKED;
  }

  /** Tear the worker down. */
  terminate() {
    this.worker.terminate();
    Atomics.store(this.cells, CELL.STATE, STATE.BOOT);
  }
}
