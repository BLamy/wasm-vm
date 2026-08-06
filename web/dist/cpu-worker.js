// E4-T22: dedicated CPU Web Worker. The interpreter (and, once E4-T10 lands, the JIT runtime)
// runs HERE, against a shared `WebAssembly.Memory` imported at instantiate time. The main thread
// keeps the DOM / xterm.js / devices and never runs the dispatch loop.
//
// Handshake (main → worker `postMessage`):
//   { type:"boot", wasmModule, sharedMemory, controlSab, bootParams }
//     wasmModule    – a WebAssembly.Module compiled main-side (structured-cloneable) OR a URL to
//                     compile in-worker via WebAssembly.compileStreaming.
//     sharedMemory  – the shared WebAssembly.Memory (guest RAM + CpuState + TLBs live in its SAB).
//     controlSab    – the small control-block SharedArrayBuffer (IRQ / MMIO cells).
//     bootParams    – kernel/initramfs/dtb offsets, RAM size, etc.
// Replies (worker → main): {type:"ready"}, {type:"log"}, {type:"halted"}, {type:"fatal",error}.
//
// Atomics.wait is legal on this thread — WFI parks here (cpu-control-block.wfiPark). The single-
// threaded fallback path never loads this file.

import {
  attachControlBlock,
  wfiPark,
  irqCount,
  mmioRequest,
  CELL,
  STATE,
} from "./cpu-control-block.js";

let cells = null;
let running = false;

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "boot") return;
  boot(msg).catch((err) => fatal(err));
});

self.addEventListener("messageerror", () => fatal(new Error("worker got an un-clonable message")));

async function boot({ wasmModule, wasmUrl, sharedMemory, controlSab, bootParams }) {
  cells = attachControlBlock(controlSab);
  Atomics.store(cells, CELL.STATE, STATE.BOOT);

  // Compile worker-side if given a URL; otherwise use the pre-compiled Module. Instantiate against
  // the IMPORTED shared memory — the module's `env.memory` import (see tools/build-web-shared.sh).
  const module =
    wasmModule ?? (await WebAssembly.compileStreaming(fetch(wasmUrl)));
  const imports = makeImports(sharedMemory);
  const instance = await WebAssembly.instantiate(module, imports);

  // The wasm-bindgen glue for the shared build initialises against this same instance/memory.
  // (Wiring the generated `initSync(module, memory)` entry point is done by the loader that
  // imports the shared pkg; here we hold the raw instance for the dispatch loop.)
  self.postMessage({ type: "ready" });

  runLoop(instance, bootParams);
}

// Minimal import object. The shared memory is injected as env.memory; MMIO traps route through the
// interim blocking stub until E4-T23 swaps in the async device proxy.
function makeImports(sharedMemory) {
  return {
    env: {
      memory: sharedMemory,
      // Interim synchronous MMIO: the wasm dispatch calls these on a device-region access; they
      // block the worker until the main thread services the request. E4-T23 replaces this.
      mmio_load: (addrLo, addrHi, width) =>
        Number(
          mmioRequest(cells, {
            addr: (BigInt(addrHi >>> 0) << 32n) | BigInt(addrLo >>> 0),
            width,
            write: false,
          }) & 0xffff_ffffn,
        ),
      mmio_store: (addrLo, addrHi, width, valLo, valHi) =>
        void mmioRequest(cells, {
          addr: (BigInt(addrHi >>> 0) << 32n) | BigInt(addrLo >>> 0),
          width,
          write: true,
          value: (BigInt(valHi >>> 0) << 32n) | BigInt(valLo >>> 0),
        }),
    },
  };
}

// The dispatch loop. Runs a bounded slice of guest instructions, then, when the guest executes WFI
// (or the slice budget is exhausted with nothing to do), parks in Atomics.wait until the next timer
// deadline or an interrupt notify. This keeps an idle guest at ~0% host CPU (AC: <2% idle).
function runLoop(instance, bootParams) {
  running = true;
  Atomics.store(cells, CELL.STATE, STATE.RUNNING);
  const step = () => {
    if (!running) return;
    // `run_slice` returns a status: 0 = keep running, >0 = WFI with a timeout hint (ms until the
    // next mtimecmp), <0 = halted. (Bound left to the core; wired when the shared export lands.)
    let status = 0;
    try {
      status = runSlice(instance, bootParams);
    } catch (err) {
      return fatal(err);
    }
    if (status < 0) {
      running = false;
      Atomics.store(cells, CELL.STATE, STATE.BOOT);
      self.postMessage({ type: "halted" });
      return;
    }
    if (status > 0) {
      // WFI: park until IRQ or the timer deadline. `status` is the ms timeout hint.
      const seen = irqCount(cells);
      Atomics.store(cells, CELL.STATE, STATE.PARKED);
      wfiPark(cells, seen, status === 0 ? Infinity : status);
      Atomics.store(cells, CELL.STATE, STATE.RUNNING);
    }
    // Yield to the worker event loop so postMessage (log flush) and MMIO responses drain.
    setTimeout(step, 0);
  };
  step();
}

// Placeholder for the core's sliced-execution export. The real symbol name/signature is finalised
// when the shared pkg's dispatch entry point is exposed (E4-T10/T11); until then the loop above is
// exercised by the host handshake + WFI tests and the browser boot leg on `dev`.
function runSlice(instance, _bootParams) {
  const fn = instance.exports.run_slice;
  if (typeof fn !== "function") {
    throw new Error("shared core module exposes no run_slice export yet (E4-T10/T11)");
  }
  return fn();
}

function fatal(err) {
  running = false;
  if (cells) Atomics.store(cells, CELL.STATE, STATE.FATAL);
  self.postMessage({ type: "fatal", error: String(err && err.stack ? err.stack : err) });
}
